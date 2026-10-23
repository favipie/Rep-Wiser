-- Verification for 202610220001_workout_targets.sql.
-- Run ONLY on a disposable database/project, never production.
-- Prerequisites: both migrations applied; users A and B exist in auth.users and each has a saved journal
-- (save_journal). A's payload is exposed as :a_payload so the sync-survival tests can re-sync it.
-- Prints PASS lines and aborts on the first failure. No failure is ever swallowed.
\set ON_ERROR_STOP 1
-- SAFETY: this script INSERTS decisions and DELETES a row from auth.users (user B). It refuses to run unless you
-- explicitly confirm the target is a disposable database:  psql ... -v confirm_disposable=yes -v a_payload="$(cat a.json)"
\if :{?confirm_disposable}
\else
  \echo REFUSING TO RUN: pass -v confirm_disposable=yes, and only against a throwaway database or project.
  \quit
\endif
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''

-- pg_temp.q: run one SELECT as an authenticated user (uid), as anon (uid null, role 'anon'), or as an
-- authenticated session with no user (uid null, role 'authenticated'). Returns the first column, or 'ERR: <message>'.
create function pg_temp.q(uid uuid, query text, as_role text default 'authenticated') returns text language plpgsql as $$
declare res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid::text,''), true);
    execute format('set local role %I', as_role);
    execute query into res;
    reset role;
    return res;
  exception when others then
    return 'ERR: ' || sqlerrm;
  end;
end $$;
create function pg_temp.expect(label text, actual text, expected text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL [%]: expected %, got %', label, expected, actual; end if;
  raise notice 'PASS  %', label;
end $$;
create function pg_temp.expect_err(label text, actual text, pattern text) returns void language plpgsql as $$
begin
  if actual is null or actual not like 'ERR:%' or actual not ilike ('%' || pattern || '%') then raise exception 'FAIL [%]: expected an error containing "%", got %', label, pattern, actual; end if;
  raise notice 'PASS  %   [%]', label, left(replace(actual, E'\n', ' '), 80);
end $$;

-- psql variables cannot be read inside dollar-quoted blocks, so pass them through custom settings.
select set_config('t.a_sess',(select session_id::text from public.performed_exercises where owner_id=:A limit 1),false),
       set_config('t.a_perf',(select id::text from public.performed_exercises where owner_id=:A limit 1),false),
       set_config('t.b_sess',(select session_id::text from public.performed_exercises where owner_id=:B limit 1),false),
       set_config('t.b_perf',(select id::text from public.performed_exercises where owner_id=:B limit 1),false) \gset

do $t$
declare
  ua uuid:='aaaaaaaa-0000-0000-0000-000000000001'; ub uuid:='bbbbbbbb-0000-0000-0000-000000000002';
  a_sess uuid:=current_setting('t.a_sess'); a_perf uuid:=current_setting('t.a_perf');
  b_sess uuid:=current_setting('t.b_sess'); b_perf uuid:=current_setting('t.b_perf');
  t1 uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid(); t3 uuid:=gen_random_uuid();
  r text; dec text;
  ins text:='with i as (insert into public.next_workout_targets(owner_id,id,exercise_id,source_session_id,source_performed_id,analysis_fingerprint,engine_version,status,suggested,weight_kg,rep_min,rep_max,sets) values (%L,gen_random_uuid(),%L,%L,%L,''f'',''v'',''accepted'',''{}'',1,1,2,1) returning 1) select count(*)::text from i';
begin
  dec := 'select public.decide_target(%L::uuid,''exercise-0'',%L::uuid,%L::uuid,''fp1'',''wie-1.0.0'',%L,''{"action":"increase"}''::jsonb,%s,%s,%s,%s)::text';

  -- ---- access control ------------------------------------------------------------------
  perform pg_temp.expect_err('anon cannot read the table', pg_temp.q(null,'select count(*)::text from public.next_workout_targets','anon'), 'permission denied');
  perform pg_temp.expect_err('anon cannot call decide_target', pg_temp.q(null, format(dec,t1,a_sess,a_perf,'accepted',42.5,6,10,3),'anon'), 'permission denied');
  perform pg_temp.expect_err('anon cannot call apply_target', pg_temp.q(null, format('select public.apply_target(%L,%L)::text',t1,a_sess),'anon'), 'permission denied');
  perform pg_temp.expect_err('signed-in role with no user id is refused', pg_temp.q(null, format(dec,t1,a_sess,a_perf,'accepted',42.5,6,10,3),'authenticated'), 'Authentication required');

  -- ---- core flow and row-level security ------------------------------------------------
  r := pg_temp.q(ua, format(dec,t1,a_sess,a_perf,'accepted',42.5,6,10,3));
  perform pg_temp.expect('A accepts a target', (r::jsonb)->>'status', 'accepted');
  perform pg_temp.expect('load stored in kg', (r::jsonb)->>'weight_kg', '42.5');
  perform pg_temp.expect('A sees own target', pg_temp.q(ua,'select count(*)::text from public.next_workout_targets'), '1');
  perform pg_temp.expect('B cannot see A''s target', pg_temp.q(ub,'select count(*)::text from public.next_workout_targets'), '0');
  perform pg_temp.expect('B cannot update A''s target', pg_temp.q(ub, format('with u as (update public.next_workout_targets set note=''x'' where id=%L returning 1) select count(*)::text from u', t1)), '0');
  perform pg_temp.expect('B cannot delete A''s target', pg_temp.q(ub, format('with d as (delete from public.next_workout_targets where id=%L returning 1) select count(*)::text from d', t1)), '0');
  perform pg_temp.expect_err('B cannot insert a row owned by A', pg_temp.q(ub, format(ins,ua,'exercise-0',a_sess,a_perf)), 'row-level security');
  perform pg_temp.expect('target untouched after B''s attempts', (select status from public.next_workout_targets where id=t1), 'accepted');

  -- ---- source integrity (soft reference enforced at write time) ------------------------
  perform pg_temp.expect_err('refuses a source workout not in the journal', pg_temp.q(ua, format(dec,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'accepted',40,6,10,3)), 'not in your saved journal');
  perform pg_temp.expect_err('refuses another user''s source workout', pg_temp.q(ua, format(dec,gen_random_uuid(),b_sess,b_perf,'accepted',40,6,10,3)), 'not in your saved journal');
  perform pg_temp.expect_err('refuses a mismatched session/exercise pair', pg_temp.q(ua, format(dec,gen_random_uuid(),b_sess,a_perf,'accepted',40,6,10,3)), 'not in your saved journal');

  -- ---- one live target per exercise; newer decisions supersede -------------------------
  r := pg_temp.q(ua, format(dec,t2,a_sess,a_perf,'modified',41,6,10,3));
  perform pg_temp.expect('modified target recorded', (r::jsonb)->>'status', 'modified');
  perform pg_temp.expect('previous live target superseded', (select status from public.next_workout_targets where id=t1), 'superseded');
  perform pg_temp.expect('exactly one live target', (select count(*)::text from public.next_workout_targets where owner_id=ua and status in ('accepted','modified')), '1');
  r := pg_temp.q(ua, format(dec,t3,a_sess,a_perf,'rejected',99,1,1,1));
  perform pg_temp.expect('rejection stores no prescription', coalesce((r::jsonb)->>'weight_kg','<null>'), '<null>');
  perform pg_temp.expect('rejecting does not retire the live target', (select status from public.next_workout_targets where id=t2), 'modified');
  perform pg_temp.expect('user can change their mind on a decision', ((pg_temp.q(ua, format(dec,t3,a_sess,a_perf,'accepted',43,6,10,3)))::jsonb)->>'status', 'accepted');
  perform pg_temp.expect('...which supersedes the older live target', (select status from public.next_workout_targets where id=t2), 'superseded');
  perform pg_temp.expect_err('unique index blocks a 2nd live target on direct insert', pg_temp.q(ua, format(ins,ua,'exercise-0',a_sess,a_perf)), 'targets_one_active_per_exercise');

  -- ---- constraints ---------------------------------------------------------------------
  perform pg_temp.expect_err('status must be a decision', pg_temp.q(ua, format(dec,gen_random_uuid(),a_sess,a_perf,'applied',40,6,10,3)), 'accepted, modified or rejected');
  perform pg_temp.expect_err('rep_max below rep_min', pg_temp.q(ua, format(dec,gen_random_uuid(),a_sess,a_perf,'accepted',40,10,6,3)), 'check constraint');
  perform pg_temp.expect_err('negative load', pg_temp.q(ua, format(dec,gen_random_uuid(),a_sess,a_perf,'accepted',-1,6,10,3)), 'check constraint');
  perform pg_temp.expect_err('zero sets', pg_temp.q(ua, format(dec,gen_random_uuid(),a_sess,a_perf,'accepted',40,6,10,0)), 'check constraint');
  perform pg_temp.expect_err('accepted without a load', pg_temp.q(ua, format(dec,gen_random_uuid(),a_sess,a_perf,'accepted','null',6,10,3)), 'check constraint');
  perform pg_temp.expect_err('note over 500 chars', pg_temp.q(ua, format($f$select public.decide_target(gen_random_uuid(),'exercise-0',%L::uuid,%L::uuid,'f','v','accepted','{}'::jsonb,40,6,10,3,%L)::text$f$, a_sess, a_perf, repeat('x',501))), 'check constraint');
  perform pg_temp.expect_err('suggestion must be a JSON object', pg_temp.q(ua, format($f$select public.decide_target(gen_random_uuid(),'exercise-0',%L::uuid,%L::uuid,'f','v','accepted','[]'::jsonb,40,6,10,3)::text$f$, a_sess, a_perf)), 'check constraint');

  -- ---- apply_target ----------------------------------------------------------------------
  perform pg_temp.expect_err('cannot apply a rejected/superseded target', pg_temp.q(ua, format('select public.apply_target(%L,%L)::text',t2,a_sess)), 'Only an accepted or modified');
  perform pg_temp.expect_err('B cannot apply A''s target', pg_temp.q(ub, format('select public.apply_target(%L,%L)::text',t3,b_sess)), 'Only an accepted or modified');
  r := pg_temp.q(ua, format('select public.apply_target(%L,%L)::text',t3,a_sess));
  perform pg_temp.expect('A applies the live target', (r::jsonb)->>'status', 'applied');
  perform pg_temp.expect('applied_at is recorded', (((r::jsonb)->>'applied_at') is not null)::text, 'true');
  perform pg_temp.expect_err('an applied target cannot be applied twice', pg_temp.q(ua, format('select public.apply_target(%L,%L)::text',t3,a_sess)), 'Only an accepted or modified');
  perform pg_temp.expect_err('an applied target cannot be edited', pg_temp.q(ua, format(dec,t3,a_sess,a_perf,'rejected',1,1,1,1)), 'already applied or replaced');
  perform pg_temp.expect('applying frees the exercise for a new live target', ((pg_temp.q(ua, format(dec,gen_random_uuid(),a_sess,a_perf,'accepted',45,6,10,3)))::jsonb)->>'status', 'accepted');
end $t$;

-- ---- survival through the journal's delete-and-reinsert sync (the reason for the no-FK design) ----
select count(*) as live_before from public.next_workout_targets where owner_id=:A \gset
select (select revision from public.profiles where owner_id=:A) as rev0 \gset
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false) \gset
set role authenticated;
select public.save_journal(:'a_payload'::jsonb, :rev0) as rev1 \gset
reset role;
select count(*) as live_after from public.next_workout_targets where owner_id=:A \gset
select (:live_before = :live_after and :live_before > 0) as survived \gset
\if :survived
  \echo PASS  decisions survive a full save_journal sync (:live_before rows before, :live_after after)
\else
  \echo FAIL decisions did not survive save_journal sync
  select 1/0;
\endif

-- deleting the source workout (journal sync with no sessions) must not fail or remove decisions
\set empty_payload '{"preferences":{"units":"kg"},"custom":[],"templates":[],"recommendations":[],"sessions":[]}'
set role authenticated;
select public.save_journal(:'empty_payload'::jsonb, :rev1) as rev2 \gset
reset role;
select count(*) as after_delete from public.next_workout_targets where owner_id=:A \gset
select (:after_delete = :live_before) as kept \gset
\if :kept
  \echo PASS  deleting every workout neither blocks sync nor removes decisions
\else
  \echo FAIL decisions changed after deleting the source workouts
  select 1/0;
\endif
-- and with the source gone, new decisions about it are refused (soft reference is validated)
select pg_temp.expect_err('no new decision for a deleted source workout',
  pg_temp.q('aaaaaaaa-0000-0000-0000-000000000001', format('select public.decide_target(gen_random_uuid(),''exercise-0'',%L::uuid,%L::uuid,''f'',''v'',''accepted'',''{}''::jsonb,1,1,2,1)::text', current_setting('t.a_sess'), current_setting('t.a_perf'))), 'not in your saved journal');
-- restore A's journal for any later test steps
set role authenticated;
select public.save_journal(:'a_payload'::jsonb, :rev2) as rev3 \gset
reset role;

-- ---- account deletion cascades only that user's decisions ------------------------------
select set_config('t.ub','bbbbbbbb-0000-0000-0000-000000000002',false) \gset
set role authenticated; select set_config('request.jwt.claim.sub',:B,false) \gset
select public.decide_target(gen_random_uuid(),'exercise-0',current_setting('t.b_sess')::uuid,current_setting('t.b_perf')::uuid,'f','v','accepted','{}'::jsonb,50,6,10,3) is not null as b_ok \gset
reset role;
select count(*) as b_rows from public.next_workout_targets where owner_id=:B \gset
select count(*) as a_rows_before from public.next_workout_targets where owner_id=:A \gset
delete from auth.users where id=:B;
select (select count(*) from public.next_workout_targets where owner_id=:B) = 0 as b_gone,
       (select count(*) from public.next_workout_targets where owner_id=:A) = :a_rows_before as a_kept,
       :b_rows > 0 as b_had_rows \gset
\if :b_gone
\else
  \echo FAIL user B decisions were not removed
  select 1/0;
\endif
\if :a_kept
\else
  \echo FAIL user A decisions changed when B was deleted
  select 1/0;
\endif
\if :b_had_rows
  \echo PASS  deleting a user removes only their decisions (B had :b_rows, A keeps :a_rows_before)
\else
  \echo FAIL setup: B had no decisions to cascade
  select 1/0;
\endif
\echo ALL CHECKS PASSED
