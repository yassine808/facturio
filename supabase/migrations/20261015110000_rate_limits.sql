-- 009: rate limiting counters (ADR-0007).
--
-- The public share route calls rate_limit_hit() BEFORE resolving any
-- token, keyed by sha256(token) + caller IP. One definer function, one
-- atomic upsert — no read-then-write race, and no external service whose
-- behavior would diverge between local, CI, and production.
--
-- Invisible to the app like invoice_counters (ADR-0006): RLS enabled with
-- zero policies, and every grant revoked — the definer function (owner
-- postgres) writes it, superuser tests read it. The function fails loud
-- on bad input; the ROUTE fails closed (any error = deny), which keeps
-- the database honest while the caller stays safe.

create table public.rate_limits (
  key text primary key check (char_length(key) between 1 and 512),
  window_start timestamptz not null default now(),
  count integer not null default 0 check (count >= 0)
);

comment on table public.rate_limits is
  'Rate-limit buckets; invisible to app roles — see rate_limit_hit().';

alter table public.rate_limits enable row level security;

revoke all on public.rate_limits from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One atomic statement: insert the bucket, or advance it (reset to 1 when
-- the window has passed). Returns whether this call is still inside the
-- budget. p_key length is capped because it is built partly from a
-- client-controlled header (first x-forwarded-for hop).
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) > 512 then
    raise exception 'rate limit key must be 1-512 characters'
      using errcode = '22023';
  end if;

  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'rate limit parameters must be positive'
      using errcode = '22023';
  end if;

  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else rl.count + 1
    end,
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else rl.window_start
    end
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer)
  from public;
grant execute on function public.rate_limit_hit(text, integer, integer)
  to anon, authenticated;
