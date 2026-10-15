-- 0010: billing platform — subscriptions, the Stripe event ledger, and the
-- plan-limit backstop. Design contract: ADR-0005.
--
-- subscriptions is the READ MODEL of Stripe state. Authenticated gets a
-- select grant and nothing else: no app code path (or buggy client) can move
-- an org between plans. The only writer is the Stripe webhook handler via
-- service_role, which keeps Supabase's default table grants.
--
-- stripe_events is the idempotency ledger for at-least-once webhook
-- deliveries (Stripe does not guarantee ordering or uniqueness): the handler
-- records event.id LAST, and a conflicting insert on retry means "already
-- handled". It is invisible to the app exactly like invoice_counters — RLS
-- enabled, zero policies, revoked from anon/authenticated.
--
-- platform_admins is the brief's platform-ops table (section 7.2). It has no
-- app surface until the Phase 6 admin milestone: zero grants, zero policies.

create type public.subscription_plan as enum ('free', 'pro');

create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  plan public.subscription_plan not null default 'free',
  -- Stripe's own lifecycle status ('active', 'past_due', 'canceled', ...).
  -- Stored for display only; the ENTITLEMENT is `plan`, never `status`.
  status text check (status is null or char_length(status) <= 40),
  stripe_customer_id text unique
    check (stripe_customer_id is null or char_length(stripe_customer_id) <= 255),
  stripe_subscription_id text unique
    check (stripe_subscription_id is null or char_length(stripe_subscription_id) <= 255),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A paid entitlement without a Stripe subscription could never be
  -- managed (no portal, no cancellation event to answer to).
  check (plan = 'free' or stripe_subscription_id is not null)
);

comment on table public.subscriptions is
  'Per-org billing entitlement, mirrored from Stripe webhooks only (ADR-0005). App role is read-only.';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "subscriptions_select"
  on public.subscriptions for select
  to authenticated
  using (public.is_org_member(org_id));

-- No INSERT/UPDATE/DELETE policy on purpose: only the webhook writes.

revoke all on public.subscriptions from anon, authenticated;

-- anon keeps the read grant (the repo-wide tenant-table contract); policies
-- are authenticated-only, so anon reads zero rows.
grant select on public.subscriptions to anon;
grant select on public.subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap: every organization is born on the free plan. Mirrors the
-- memberships bootstrap pattern — SECURITY DEFINER because the org creator
-- has no insert grant on subscriptions (by design, see above).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_organization_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (org_id)
  values (new.id);
  return new;
end;
$$;

create trigger on_organization_created_subscription
  after insert on public.organizations
  for each row execute function public.handle_new_organization_subscription();

-- ---------------------------------------------------------------------------
-- Plan limits, enforced in the DB like every other rule (defense in depth:
-- the app hides the button, the trigger is the authority). The meter is
-- ACTIVE (non-archived) clients per org: free = 3, pro = unlimited.
-- Future meters copy this pattern. NOTE for test/seed authors: this trigger
-- fires for every insert, superuser included — set plan = 'pro' (as
-- superuser) when a fixture needs more than 3 active clients in one org.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_plan_client_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.subscription_plan;
  v_active integer;
begin
  select plan into v_plan
  from public.subscriptions
  where org_id = new.org_id;

  -- coalesce: a missing bootstrap row falls back to the restricted plan,
  -- never to the unrestricted one.
  if coalesce(v_plan, 'free') <> 'free' then
    return new;
  end if;

  -- Covers INSERT and the restore half of the archive toggle: the row being
  -- restored is still archived in the table, so it is not in this count.
  select count(*)::integer into v_active
  from public.clients
  where org_id = new.org_id and archived_at is null;

  if v_active >= 3 then
    raise exception 'free plan includes 3 active clients — archive one or upgrade to pro';
  end if;

  return new;
end;
$$;

create trigger clients_plan_limit
  before insert or update on public.clients
  for each row
  when (new.archived_at is null)
  execute function public.enforce_plan_client_limit();

-- ---------------------------------------------------------------------------
-- Stripe event ledger: invisible to the app, insert-only for the webhook.
-- ---------------------------------------------------------------------------

create table public.stripe_events (
  -- Stripe event id (evt_...). Unique by primary key: the duplicate check
  -- IS the idempotency mechanism (insert last, conflict = already handled).
  id text primary key check (char_length(id) <= 255),
  type text not null check (char_length(type) <= 255),
  -- Stripe's own event timestamp, recorded for debugging. Never used for
  -- ordering: Stripe does not guarantee delivery order (ADR-0005).
  stripe_created_at timestamptz,
  received_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Webhook idempotency ledger (ADR-0005). Handler-only: RLS on, zero policies, no app grants.';

alter table public.stripe_events enable row level security;

revoke all on public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Platform admins (brief section 7.2). Ops-only until the Phase 6 admin
-- milestone builds a surface for it; deliberately unreadable and unwritable
-- by the app in the meantime.
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Platform (not tenant) operators. No app access until the Phase 6 admin surface.';

alter table public.platform_admins enable row level security;

revoke all on public.platform_admins from anon, authenticated;
