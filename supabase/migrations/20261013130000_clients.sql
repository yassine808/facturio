-- 0005: clients — the first real tenant data table of the core domain.
--
-- Domain rules baked into the schema: clients are archived, never deleted
-- (invoices must keep referencing them forever), and they never move between
-- organizations (org_id carries no update grant, and every policy's WITH
-- CHECK re-verifies membership on the new row value).

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  -- Nullable on purpose: one-off clients are normal. Email format is
  -- validated by Zod at every app boundary; the DB only caps the length —
  -- a second pattern here would just duplicate zod with false negatives.
  email text check (email is null or char_length(email) <= 320),
  address text check (address is null or char_length(address) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is
  'Tenant-scoped customer records. Archived, never deleted (invoices reference them forever).';

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create index clients_org_idx on public.clients (org_id);

-- ---------------------------------------------------------------------------
-- RLS: default deny, one policy per operation, members own the working data.
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;

create policy "clients_select"
  on public.clients for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "clients_insert"
  on public.clients for insert
  to authenticated
  with check (public.is_org_member(org_id));

create policy "clients_update"
  on public.clients for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- No DELETE policy on purpose: archive instead (see header).

-- ---------------------------------------------------------------------------
-- Grants (grants precede RLS — see ADR-0002 / 020-organizations tests).
-- ---------------------------------------------------------------------------

revoke all on public.clients from anon, authenticated;

-- anon keeps the read grant; policies are authenticated-only, so anon reads
-- zero rows. This is the contract every tenant table in this repo follows.
grant select on public.clients to anon;

grant select, insert on public.clients to authenticated;
-- org_id is deliberately NOT in the update grant: a cross-tenant move fails
-- at the grant layer (42501) before RLS even evaluates the row.
grant update (name, email, address, archived_at) on public.clients to authenticated;
