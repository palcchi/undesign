-- Durable production quota store for every agent request, including BYO-key calls.
-- No raw IPs are stored; minute bucket_key is a keyed HMAC-SHA256 from the server.
create table if not exists public.usage_counters (
  bucket_type text not null check (bucket_type in ('minute', 'daily')),
  bucket_key text not null,
  window_start timestamptz not null,
  request_count bigint not null default 0 check (request_count >= 0),
  primary key (bucket_type, bucket_key, window_start)
);

create index if not exists usage_counters_window_start_idx
  on public.usage_counters (window_start);

alter table public.usage_counters enable row level security;
revoke all on table public.usage_counters from public, anon, authenticated;
grant all on table public.usage_counters to service_role;

create or replace function public.reserve_agent_usage(
  p_ip_hash text,
  p_minute_start timestamptz,
  p_daily_start timestamptz,
  p_rate_limit integer,
  p_daily_limit integer
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ip_count bigint;
  daily_count bigint;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64
     or p_rate_limit < 1 or p_daily_limit < 1 then
    raise exception 'invalid quota arguments';
  end if;

  -- Make both buckets if needed, then lock in a consistent order before checking.
  insert into public.usage_counters (bucket_type, bucket_key, window_start, request_count)
  values ('minute', p_ip_hash, p_minute_start, 0)
  on conflict (bucket_type, bucket_key, window_start) do nothing;
  insert into public.usage_counters (bucket_type, bucket_key, window_start, request_count)
  values ('daily', 'global', p_daily_start, 0)
  on conflict (bucket_type, bucket_key, window_start) do nothing;

  select uc.request_count into ip_count
    from public.usage_counters as uc
    where uc.bucket_type = 'minute'
      and uc.bucket_key = p_ip_hash
      and uc.window_start = p_minute_start
    for update;
  select uc.request_count into daily_count
    from public.usage_counters as uc
    where uc.bucket_type = 'daily'
      and uc.bucket_key = 'global'
      and uc.window_start = p_daily_start
    for update;

  if ip_count >= p_rate_limit then
    return query select false, 'RATE_LIMITED'::text;
    return;
  end if;
  if daily_count >= p_daily_limit then
    return query select false, 'DAILY_BUDGET_EXCEEDED'::text;
    return;
  end if;

  update public.usage_counters as uc
    set request_count = uc.request_count + 1
    where uc.bucket_type = 'minute'
      and uc.bucket_key = p_ip_hash
      and uc.window_start = p_minute_start;
  update public.usage_counters as uc
    set request_count = uc.request_count + 1
    where uc.bucket_type = 'daily'
      and uc.bucket_key = 'global'
      and uc.window_start = p_daily_start;

  -- Retain only recent buckets; the index bounds cleanup work for this demo table.
  delete from public.usage_counters as uc
    where uc.window_start < p_daily_start - interval '2 days';

  return query select true, null::text;
end;
$$;

revoke all on function public.reserve_agent_usage(text, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_agent_usage(text, timestamptz, timestamptz, integer, integer)
  to service_role;
