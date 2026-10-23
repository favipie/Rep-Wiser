-- Rollback for 202610220001_workout_targets.sql. NOT in migrations/ so it never runs automatically.
-- Removes only the target-decision objects. The journal tables and their data are not touched.
-- WARNING: this permanently deletes users' saved accept/modify/reject decisions.
begin;
drop function if exists public.apply_target(uuid,uuid);
drop function if exists public.target_context(uuid,uuid);
drop function if exists public.decide_target(uuid,text,uuid,uuid,text,text,text,jsonb,numeric,integer,integer,integer,text);
drop table if exists public.next_workout_targets;
commit;
