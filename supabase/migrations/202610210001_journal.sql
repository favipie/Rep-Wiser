-- REPWISE: normalized private journal, transactional saves, optimistic concurrency.
create table public.profiles (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb,
 revision integer not null default 0 check (revision>=0)
);
create table public.exercises (
 id text not null, owner_id uuid not null references auth.users(id) on delete cascade,
 definition jsonb not null,
 primary key(owner_id,id)
);
create table public.workout_templates (
 id uuid not null,owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null,days jsonb not null default '[]',position integer not null,
 primary key(owner_id,id)
);
create table public.template_exercises (
 id uuid not null,owner_id uuid not null,template_id uuid not null,
 position integer not null, prescription jsonb not null,
 primary key(owner_id,id),
 foreign key(owner_id,template_id) references public.workout_templates(owner_id,id) on delete cascade
);
create table public.workout_sessions (
 id uuid not null,owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(trim(name))>0),date timestamptz not null,
 status text not null check(status in ('draft','complete')),
 primary key(owner_id,id)
);
create index sessions_by_date on public.workout_sessions(owner_id,date desc);
create table public.performed_exercises (
 id uuid not null, owner_id uuid not null,session_id uuid not null,
 position integer not null, prescription jsonb not null,
 primary key(owner_id,id),
 foreign key(owner_id,session_id) references public.workout_sessions(owner_id,id) on delete cascade
);
create index performed_by_session on public.performed_exercises(owner_id,session_id);
create table public.sets (
 id uuid not null,owner_id uuid not null,performed_id uuid not null,
 position integer not null,
 weight numeric not null check(weight>=0 and weight<=1500),
 reps integer not null check(reps>=0 and reps<=200),
 rir numeric check(rir>=0 and rir<=10),
 done boolean not null,warmup boolean not null,
 primary key(owner_id,id),
 foreign key(owner_id,performed_id) references public.performed_exercises(owner_id,id) on delete cascade,
 check(not done or reps>0)
);
create index sets_by_exercise on public.sets(owner_id,performed_id);
create table public.progression_recommendations (
 owner_id uuid not null,performed_id uuid not null,decision jsonb not null,
 primary key(owner_id,performed_id),
 foreign key(owner_id,performed_id) references public.performed_exercises(owner_id,id) on delete cascade
);
create table public.personal_records (
 owner_id uuid not null references auth.users(id) on delete cascade,
 exercise_id text not null,load numeric not null,
 primary key(owner_id,exercise_id)
);
do $$ declare t text; begin
 foreach t in array array['profiles','exercises','workout_templates','template_exercises','workout_sessions','performed_exercises','sets','progression_recommendations','personal_records'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('revoke all on public.%I from anon',t);
 end loop;
end $$;

create function public.read_journal() returns jsonb language plpgsql security invoker set search_path=public as $$
declare who uuid:=auth.uid();result jsonb;
begin
 if who is null then raise exception 'Authentication required';end if;
 select jsonb_build_object('revision',p.revision,'data',jsonb_build_object(
 'preferences',p.preferences,
 'custom',coalesce((select jsonb_agg(definition order by id) from exercises where owner_id=who),'[]'),
 'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'days',t.days,'exercises',
 coalesce((select jsonb_agg(te.prescription order by te.position) from template_exercises te where te.owner_id=who and te.template_id=t.id),'[]')) order by t.position) from workout_templates t where t.owner_id=who),'[]'),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'date',s.date,'status',s.status,'exercises',
 coalesce((select jsonb_agg(e.prescription || jsonb_build_object('sets',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'weight',st.weight,'reps',st.reps,'rir',st.rir,'done',st.done,'warmup',st.warmup) order by st.position) from sets st where st.owner_id=who and st.performed_id=e.id),'[]')) order by e.position) from performed_exercises e where e.owner_id=who and e.session_id=s.id),'[]')) order by s.date) from workout_sessions s where s.owner_id=who),'[]')
 )) into result from profiles p where p.owner_id=who;
 return coalesce(result,jsonb_build_object('revision',0,'data',jsonb_build_object('preferences',null,'custom','[]'::jsonb,'templates','[]'::jsonb,'sessions','[]'::jsonb)));
end $$;

create function public.save_journal(payload jsonb,expected_revision integer) returns integer language plpgsql security invoker set search_path=public as $$
declare who uuid:=auth.uid();rev integer;s jsonb;e jsonb;st jsonb;t jsonb;i integer;j integer;
begin
 if who is null then raise exception 'Authentication required';end if;
 if jsonb_typeof(payload->'sessions')<>'array' or jsonb_typeof(payload->'templates')<>'array' or jsonb_typeof(payload->'custom')<>'array' then raise exception 'Invalid journal';end if;
 insert into profiles(owner_id) values(who) on conflict do nothing;
 select revision into rev from profiles where owner_id=who for update;
 if rev<>expected_revision then raise exception 'Cloud version changed. Export your device copy before reloading or reconciling.';end if;
 delete from workout_sessions where owner_id=who;
 delete from workout_templates where owner_id=who;
 delete from exercises where owner_id=who;
 delete from personal_records where owner_id=who;
 for e in select value from jsonb_array_elements(payload->'custom') loop
 insert into exercises(owner_id,id,definition) values(who,e->>'id',e);
 end loop;
 i:=0;
 for t in select value from jsonb_array_elements(payload->'templates') loop
 insert into workout_templates(owner_id,id,name,days,position) values(who,(t->>'id')::uuid,t->>'name',t->'days',i);i:=i+1;j:=0;
 for e in select value from jsonb_array_elements(t->'exercises') loop
 insert into template_exercises(owner_id,id,template_id,position,prescription) values(who,(e->>'id')::uuid,(t->>'id')::uuid,j,e);j:=j+1;
 end loop;end loop;
 for s in select value from jsonb_array_elements(payload->'sessions') loop
 insert into workout_sessions(owner_id,id,name,date,status) values(who,(s->>'id')::uuid,s->>'name',(s->>'date')::timestamptz,s->>'status');i:=0;
 for e in select value from jsonb_array_elements(s->'exercises') loop
 insert into performed_exercises(owner_id,id,session_id,position,prescription) values(who,(e->>'id')::uuid,(s->>'id')::uuid,i,e-'sets');i:=i+1;j:=0;
 for st in select value from jsonb_array_elements(e->'sets') loop
 insert into sets(owner_id,id,performed_id,position,weight,reps,rir,done,warmup) values(who,(st->>'id')::uuid,(e->>'id')::uuid,j,(st->>'weight')::numeric,(st->>'reps')::integer,(st->>'rir')::numeric,(st->>'done')::boolean,(st->>'warmup')::boolean);j:=j+1;
 end loop;end loop;end loop;
 insert into personal_records(owner_id,exercise_id,load)
 select who,e.prescription->>'exerciseId',max(st.weight) from performed_exercises e join sets st on st.owner_id=e.owner_id and st.performed_id=e.id join workout_sessions s on s.owner_id=e.owner_id and s.id=e.session_id where e.owner_id=who and s.status='complete' and st.done and not st.warmup group by e.prescription->>'exerciseId';
 for e in select value from jsonb_array_elements(coalesce(payload->'recommendations','[]'::jsonb)) loop
 insert into progression_recommendations(owner_id,performed_id,decision) values(who,(e->>'performedId')::uuid,e->'decision');
 end loop;
 update profiles set preferences=payload->'preferences',revision=rev+1 where owner_id=who;
 return rev+1;
end $$;
revoke all on function public.read_journal() from public,anon;
revoke all on function public.save_journal(jsonb,integer) from public,anon;
grant execute on function public.read_journal() to authenticated;
grant execute on function public.save_journal(jsonb,integer) to authenticated;
