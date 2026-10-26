-- New quota table only. Does not alter journals or workout targets.
create table public.coach_usage (
  bucket text primary key,
  requests integer not null check (requests >= 0),
  expires_at timestamptz not null
);
alter table public.coach_usage enable row level security;
revoke all on public.coach_usage from public, anon, authenticated;

create function public.reserve_coach_request(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  stamp timestamptz := clock_timestamp();
  day_stamp text := to_char(stamp at time zone 'UTC', 'YYYY-MM-DD');
  minute_stamp text := to_char(stamp at time zone 'UTC', 'YYYY-MM-DD-HH24-MI');
  keys text[];
  caps integer[] := array[200,20,5];
  i integer;
begin
  if p_user is null or not exists (select 1 from auth.users where id=p_user) then return false; end if;
  perform pg_advisory_xact_lock(827461095);
  delete from public.coach_usage where expires_at < stamp;
  keys := array['global:'||day_stamp, 'user:'||p_user||':'||day_stamp, 'minute:'||p_user||':'||minute_stamp];
  for i in 1..3 loop
    if coalesce((select requests from public.coach_usage where bucket=keys[i]),0) >= caps[i] then return false; end if;
  end loop;
  for i in 1..3 loop
    insert into public.coach_usage(bucket,requests,expires_at) values(keys[i],1,stamp + interval '25 hours')
    on conflict(bucket) do update set requests=public.coach_usage.requests+1;
  end loop;
  return true;
end;
$$;
revoke all on function public.reserve_coach_request(uuid) from public, anon, authenticated;
grant execute on function public.reserve_coach_request(uuid) to service_role;
