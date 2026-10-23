-- REPWISE: next-workout target decisions (accept / modify / reject).
--
-- Review-only migration. Reads journal data and locks the owner's profile during decisions.
-- Does not rewrite journal records. Never run verification against production.
-- Requires 202610210001_journal.sql to be applied first.
--
-- WHY NO FOREIGN KEY TO workout_sessions / performed_exercises:
-- public.save_journal() deletes and re-inserts every session, exercise and set on each sync.
--   * an FK with ON DELETE CASCADE would erase every decision on every sync;
--   * an FK without cascade would make save_journal fail.
-- (Both were reproduced against this exact schema before this file was written.)
-- So decisions are anchored to auth.users only, and source ids are soft references that
-- decide_target() validates at write time.
begin;

do $$ begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.performed_exercises') is null
     or to_regprocedure('public.save_journal(jsonb,integer)') is null then
    raise exception 'The REPWISE journal schema (202610210001_journal.sql) must be applied first.';
  end if;
  if to_regclass('public.next_workout_targets') is not null then
    raise exception 'public.next_workout_targets already exists; refusing to continue.';
  end if;
end $$;

create table public.next_workout_targets (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  exercise_id text not null check (length(exercise_id) between 1 and 100),
  -- Soft references (deliberately no FK, see header). The report these came from.
  source_session_id uuid not null,
  source_performed_id uuid not null,
  -- Fingerprint of the records the suggestion was computed from; lets the app tell when the
  -- source workout was edited after the decision.
  analysis_fingerprint text not null check (length(analysis_fingerprint) between 1 and 64),
  engine_version text not null check (length(engine_version) between 1 and 40),
  status text not null check (status in ('accepted','modified','rejected','applied','superseded')),
  -- The engine's suggestion exactly as shown to the user (audit trail; never used for decisions).
  suggested jsonb not null check (jsonb_typeof(suggested)='object'),
  -- The user's decision. Loads are stored in kg, like sets.weight.
  weight_kg numeric check (weight_kg>=0 and weight_kg<=1500),
  rep_min integer check (rep_min between 1 and 200),
  rep_max integer check (rep_max between 1 and 200),
  sets integer check (sets between 1 and 20),
  note text check (length(note)<=500),
  decided_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_session_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id,id),
  check (rep_min is null or rep_max is null or rep_max>=rep_min),
  -- Anything the user accepted must carry a complete prescription.
  check (status in ('rejected','superseded') or (weight_kg is not null and rep_min is not null and rep_max is not null and sets is not null)),
  check ((status='applied')=(applied_at is not null))
);
comment on table public.next_workout_targets is
  'User decisions on suggested next-workout targets. No FK to sessions/performed_exercises on purpose: save_journal() rewrites those tables on every sync.';

-- At most one live (accepted/modified) target per exercise, so planning has a single answer.
create unique index targets_one_active_per_exercise on public.next_workout_targets(owner_id,exercise_id) where status in ('accepted','modified');
create index targets_by_source_session on public.next_workout_targets(owner_id,source_session_id);
create index targets_by_exercise on public.next_workout_targets(owner_id,exercise_id,decided_at desc);

alter table public.next_workout_targets enable row level security;
create policy own_rows on public.next_workout_targets for select to authenticated
  using ((select auth.uid())=owner_id);
revoke all on public.next_workout_targets from public, anon, authenticated;
grant select on public.next_workout_targets to authenticated;


-- Server-derived exercise context. Includes all completed history through the source,
-- preferences and custom definition. Unrelated exercise edits do not invalidate it.
create function public.target_context(p_session_id uuid, p_performed_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); source public.workout_sessions; ex text; snapshot jsonb; rev integer;
begin
  if who is null then raise sqlstate '42501' using message='Authentication required'; end if;
  select * into source from public.workout_sessions where owner_id=who and id=p_session_id and status='complete';
  select prescription->>'exerciseId' into ex from public.performed_exercises
    where owner_id=who and id=p_performed_id and session_id=source.id;
  if ex is null then raise sqlstate 'PT409' using message='Source workout was removed or is incomplete. Reopen analysis.'; end if;
  select revision into rev from public.profiles where owner_id=who;
  select jsonb_build_object('preferences',p.preferences,'custom',
    (select definition from public.exercises where owner_id=who and id=ex),'history',
    (select jsonb_agg(jsonb_build_object('session',s.id,'date',s.date,'exercise',e.prescription,'sets',
      (select jsonb_agg(to_jsonb(st)-'owner_id' order by st.position,st.id) from public.sets st where st.owner_id=who and st.performed_id=e.id))
      order by s.date,s.id,e.position,e.id)
     from public.workout_sessions s join public.performed_exercises e on e.owner_id=s.owner_id and e.session_id=s.id
     where s.owner_id=who and s.status='complete' and s.date<=source.date and e.prescription->>'exerciseId'=ex))
    into snapshot from public.profiles p where p.owner_id=who;
  return jsonb_build_object('fingerprint',md5(snapshot::text),'revision',rev,'exerciseId',ex);
end $$;

-- A new ID is an immutable decision event. Only lifecycle status may change.
-- Expected-active comparison prevents two tabs silently replacing one another.
create or replace function public.decide_target(
  p_id uuid, p_exercise_id text, p_source_session_id uuid, p_source_performed_id uuid,
  p_fingerprint text, p_engine_version text, p_status text, p_suggested jsonb,
  p_weight_kg numeric, p_rep_min integer, p_rep_max integer, p_sets integer, p_note text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); saved public.next_workout_targets; ctx jsonb; active_id uuid;
begin
  if who is null then raise sqlstate '42501' using message='Authentication required'; end if;
  -- Same lock as save_journal, acquired before reading any journal or target records.
  perform 1 from public.profiles where owner_id=who for update;
  if not found then raise sqlstate 'PT409' using message='Sync your journal first.'; end if;
  if p_status is null or p_status not in ('accepted','modified','rejected') or p_engine_version is distinct from 'wie-1.0.0' then
    raise sqlstate '22023' using message='Unsupported decision or engine version';
  end if;
  ctx:=public.target_context(p_source_session_id,p_source_performed_id);
  if ctx->>'exerciseId' is distinct from p_exercise_id or ctx->>'fingerprint' is distinct from p_fingerprint
    or (ctx->>'revision')::integer is distinct from (p_suggested->>'_revision')::integer then
    raise sqlstate 'PT409' using message='Analysis changed. Sync and reopen it before deciding.';
  end if;
  if exists(select 1 from public.workout_sessions s join public.performed_exercises e on e.owner_id=s.owner_id and e.session_id=s.id
    where s.owner_id=who and s.status='complete' and e.prescription->>'exerciseId'=p_exercise_id
    and s.date>(select date from public.workout_sessions where owner_id=who and id=p_source_session_id)) then
    raise sqlstate 'PT409' using message='A newer workout exists. Review its analysis instead.';
  end if;
  if exists(select 1 from public.next_workout_targets where owner_id=who and id=p_id) then
    raise sqlstate 'PT409' using message='Decision ID already exists. Reload saved decisions.';
  end if;
  select id into active_id from public.next_workout_targets where owner_id=who and exercise_id=p_exercise_id and status in ('accepted','modified');
  if active_id is distinct from (p_suggested->>'_expectedActive')::uuid then
    raise sqlstate 'PT409' using message='Another decision changed this target. Reload before replacing it.';
  end if;
  update public.next_workout_targets set status='superseded',updated_at=now() where owner_id=who and id=active_id;
  insert into public.next_workout_targets(owner_id,id,exercise_id,source_session_id,source_performed_id,analysis_fingerprint,
    engine_version,status,suggested,weight_kg,rep_min,rep_max,sets,note)
  values(who,p_id,p_exercise_id,p_source_session_id,p_source_performed_id,p_fingerprint,p_engine_version,p_status,p_suggested,
    case when p_status='rejected' then null else p_weight_kg end,case when p_status='rejected' then null else p_rep_min end,
    case when p_status='rejected' then null else p_rep_max end,case when p_status='rejected' then null else p_sets end,p_note)
  returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.apply_target(p_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); saved public.next_workout_targets; ctx jsonb; destination public.workout_sessions;
begin
  if who is null then raise sqlstate '42501' using message='Authentication required'; end if;
  perform 1 from public.profiles where owner_id=who for update;
  select * into saved from public.next_workout_targets where owner_id=who and id=p_id;
  if not found then raise sqlstate '42501' using message='Target is not available'; end if;
  -- Safe retry after a lost response; never allows reuse in a different workout.
  if saved.status='applied' and saved.applied_session_id=p_session_id then return to_jsonb(saved); end if;
  if saved.status not in ('accepted','modified') then raise sqlstate 'PT409' using message='Target was replaced or already used'; end if;
  ctx:=public.target_context(saved.source_session_id,saved.source_performed_id);
  if saved.analysis_fingerprint is distinct from ctx->>'fingerprint' or saved.engine_version<>'wie-1.0.0' then
    raise sqlstate 'PT409' using message='Target is stale. Review the source analysis again.';
  end if;
  select * into destination from public.workout_sessions where owner_id=who and id=p_session_id and status='complete';
  if destination.id is null or destination.id=saved.source_session_id or destination.date<=
    (select date from public.workout_sessions where owner_id=who and id=saved.source_session_id) then
    raise sqlstate '42501' using message='Destination must be your subsequent completed workout';
  end if;
  if not exists(select 1 from public.performed_exercises e where e.owner_id=who and e.session_id=p_session_id
    and e.prescription->>'exerciseId'=saved.exercise_id and e.prescription->>'targetId'=p_id::text
    and (e.prescription->>'targetWeight')::numeric=saved.weight_kg
    and (e.prescription->>'min')::integer=saved.rep_min and (e.prescription->>'max')::integer=saved.rep_max
    and (e.prescription->>'required')::integer=saved.sets) then
    raise sqlstate 'PT409' using message='The destination does not contain this saved target prescription';
  end if;
  if exists(select 1 from public.workout_sessions s join public.performed_exercises e on e.owner_id=s.owner_id and e.session_id=s.id
    where s.owner_id=who and s.status='complete' and s.id<>p_session_id and e.prescription->>'exerciseId'=saved.exercise_id
    and s.date>(select date from public.workout_sessions where owner_id=who and id=saved.source_session_id)) then
    raise sqlstate 'PT409' using message='A newer workout invalidated this target';
  end if;
  update public.next_workout_targets set status='applied',applied_at=now(),applied_session_id=p_session_id,updated_at=now()
    where owner_id=who and id=p_id returning * into saved;
  return to_jsonb(saved);
end $$;
revoke all on function public.target_context(uuid,uuid) from public,anon;
grant execute on function public.target_context(uuid,uuid) to authenticated;
revoke all on function public.decide_target(uuid,text,uuid,uuid,text,text,text,jsonb,numeric,integer,integer,integer,text) from public,anon;
revoke all on function public.apply_target(uuid,uuid) from public,anon;
grant execute on function public.decide_target(uuid,text,uuid,uuid,text,text,text,jsonb,numeric,integer,integer,integer,text) to authenticated;
grant execute on function public.apply_target(uuid,uuid) to authenticated;
commit;
