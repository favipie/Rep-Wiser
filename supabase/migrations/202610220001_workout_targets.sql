-- REPWISE: next-workout target decisions (accept / modify / reject).
--
-- ADDITIVE ONLY. Creates one table, three indexes, one RLS policy and two functions.
-- It does not alter, lock, read or rewrite any existing table, function or row.
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
create policy own_rows on public.next_workout_targets for all to authenticated
  using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
grant select,insert,update,delete on public.next_workout_targets to authenticated;
revoke all on public.next_workout_targets from anon;

-- Record (or change) a decision. Atomically retires the exercise's previous live target.
create function public.decide_target(
  p_id uuid, p_exercise_id text, p_source_session_id uuid, p_source_performed_id uuid,
  p_fingerprint text, p_engine_version text, p_status text, p_suggested jsonb,
  p_weight_kg numeric, p_rep_min integer, p_rep_max integer, p_sets integer, p_note text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare who uuid:=auth.uid(); saved public.next_workout_targets;
begin
  if who is null then raise exception 'Authentication required'; end if;
  if p_status not in ('accepted','modified','rejected') then raise exception 'Status must be accepted, modified or rejected'; end if;
  -- Soft-reference check: the source exercise must exist in this user's saved journal, inside that session.
  if not exists (select 1 from public.performed_exercises where owner_id=who and id=p_source_performed_id and session_id=p_source_session_id) then
    raise exception 'The source workout is not in your saved journal yet. Sync, then try again.';
  end if;
  if p_status in ('accepted','modified') then
    update public.next_workout_targets set status='superseded', updated_at=now()
      where owner_id=who and exercise_id=p_exercise_id and status in ('accepted','modified') and id<>p_id;
  end if;
  insert into public.next_workout_targets as t (owner_id,id,exercise_id,source_session_id,source_performed_id,analysis_fingerprint,engine_version,status,suggested,weight_kg,rep_min,rep_max,sets,note)
  values (who,p_id,p_exercise_id,p_source_session_id,p_source_performed_id,p_fingerprint,p_engine_version,p_status,p_suggested,
          case when p_status='rejected' then null else p_weight_kg end, case when p_status='rejected' then null else p_rep_min end,
          case when p_status='rejected' then null else p_rep_max end, case when p_status='rejected' then null else p_sets end, p_note)
  on conflict (owner_id,id) do update set
    analysis_fingerprint=excluded.analysis_fingerprint, engine_version=excluded.engine_version, status=excluded.status, suggested=excluded.suggested,
    weight_kg=excluded.weight_kg, rep_min=excluded.rep_min, rep_max=excluded.rep_max, sets=excluded.sets, note=excluded.note,
    decided_at=now(), updated_at=now()
    where t.status in ('accepted','modified','rejected') and t.exercise_id=excluded.exercise_id
  returning * into saved;
  if not found then raise exception 'This target was already applied or replaced and cannot be changed.'; end if;
  return to_jsonb(saved);
end $$;

-- Mark a live target as used by a workout (called when that workout is finished).
create function public.apply_target(p_id uuid, p_session_id uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare who uuid:=auth.uid(); saved public.next_workout_targets;
begin
  if who is null then raise exception 'Authentication required'; end if;
  update public.next_workout_targets set status='applied', applied_at=now(), applied_session_id=p_session_id, updated_at=now()
    where owner_id=who and id=p_id and status in ('accepted','modified') returning * into saved;
  if not found then raise exception 'Only an accepted or modified target can be applied.'; end if;
  return to_jsonb(saved);
end $$;

revoke all on function public.decide_target(uuid,text,uuid,uuid,text,text,text,jsonb,numeric,integer,integer,integer,text) from public,anon;
revoke all on function public.apply_target(uuid,uuid) from public,anon;
grant execute on function public.decide_target(uuid,text,uuid,uuid,text,text,text,jsonb,numeric,integer,integer,integer,text) to authenticated;
grant execute on function public.apply_target(uuid,uuid) to authenticated;

commit;
