-- 0002: organizations, memberships, and the RLS helper functions.
--
-- Tenancy model (ADR-0002): shared database, `org_id` on every tenant row,
-- isolation enforced by RLS. Helper functions (ADR-0004) are SECURITY DEFINER
-- so policies can read *true* membership without recursing into memberships'
-- own policies — that recursion-free oracle is the whole trick.
--
-- Joining an organization happens two ways only, both definer-mediated:
--   1. creating the org (trigger below makes the creator the owner), and
--   2. accepting an invitation (accept_invitation, in the invitations
--      migration). There is deliberately NO insert policy on memberships for
--      authenticated users — otherwise "insert yourself as owner of any org"
--      would be one PostgREST call away.

create type public.org_role as enum ('owner', 'admin', 'member');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  -- slug is part of the URL; immutable after creation (column-level grant below).
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'Tenant root. One row per workspace.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

comment on table public.memberships is 'User <-> organization with a role. RLS-visible to fellow members.';

create index memberships_user_idx on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- RLS helpers (ADR-0004): SECURITY DEFINER, empty search_path, narrow grants.
-- Definer means they read memberships unfiltered by RLS = ground truth, which
-- both avoids policy recursion and makes them trustworthy as an oracle.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.org_role(p_org_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.memberships
  where org_id = p_org_id and user_id = (select auth.uid());
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.org_role(p_org_id) = any (p_roles), false);
$$;

-- Used by the profiles policy: may this user see ANOTHER user's profile?
create or replace function public.share_org_with(p_other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships a
      join public.memberships b on a.org_id = b.org_id
     where a.user_id = (select auth.uid())
       and b.user_id = p_other_user
  );
$$;

-- Functions in Postgres are executable by PUBLIC by default; narrow that to
-- the roles that actually need them (anon gets nothing — auth.uid() would be
-- null anyway, but an RPC surface that always answers false is noise).
revoke execute on function public.is_org_member(uuid) from anon, public;
revoke execute on function public.org_role(uuid) from anon, public;
revoke execute on function public.has_org_role(uuid, public.org_role[]) from anon, public;
revoke execute on function public.share_org_with(uuid) from anon, public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;
grant execute on function public.share_org_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap: creating an org makes the creator its owner (definer so it can
-- insert into memberships, which has no authenticated insert policy).
-- audit_logs lands in the next migration; this function is replaced there to
-- also record org.created — migration-local replacement keeps the FK order sane.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'organizations must be created by a signed-in user';
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (new.id, v_uid, 'owner');

  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------------------------------------------------------------------------
-- Backstop: an organization always keeps at least one owner. The app enforces
-- role rules too, but this trigger is the invariant that survives any bug.
-- The two skips are cascade contexts, not role changes: deleting an org or an
-- account removes rows wholesale and must not be blocked here.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_owner_backstop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cascade contexts: the org row is already gone when memberships cascade
  -- after it; the profile row is already gone when a user account is deleted.
  if not exists (select 1 from public.organizations o where o.id = old.org_id)
     or not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    if not exists (
      select 1 from public.memberships
      where org_id = old.org_id and id <> old.id and role = 'owner'
    ) then
      raise exception 'an organization must keep at least one owner';
    end if;
  elsif tg_op = 'DELETE' and old.role = 'owner' then
    if not exists (
      select 1 from public.memberships
      where org_id = old.org_id and id <> old.id and role = 'owner'
    ) then
      raise exception 'an organization must keep at least one owner';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger memberships_owner_backstop
  before update or delete on public.memberships
  for each row execute function public.enforce_owner_backstop();

-- ---------------------------------------------------------------------------
-- RLS: default deny, one policy per operation.
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

-- Members read their own orgs.
create policy "organizations_select"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

-- Any signed-in user may create an org (the trigger makes them its owner).
create policy "organizations_insert"
  on public.organizations for insert
  to authenticated
  with check ((select auth.uid()) is not null);

-- Rename: owner/admin only. Slug updates are already impossible (no grant).
create policy "organizations_update"
  on public.organizations for update
  to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- No DELETE policy: removing an organization is out of scope for Phase 2.

-- Members see who else is in the org (member lists).
create policy "memberships_select"
  on public.memberships for select
  to authenticated
  using (public.is_org_member(org_id));

-- Role changes: admins manage non-owner rows; only owners touch owner rows.
-- WITH CHECK blocks granting the owner role unless the caller already is one.
create policy "memberships_update"
  on public.memberships for update
  to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(org_id, array['owner']::public.org_role[]))
  )
  with check (
    public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(org_id, array['owner']::public.org_role[]))
  );

-- Removal: you may always leave yourself; admins may remove non-owners;
-- owners may remove anyone (the trigger still protects the last one).
-- No INSERT policy on purpose — see the header comment.
create policy "memberships_delete"
  on public.memberships for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
        and role <> 'owner')
    or public.has_org_role(org_id, array['owner']::public.org_role[])
  );

-- ---------------------------------------------------------------------------
-- Grants: Supabase's default privileges hand every new table to anon and
-- authenticated. Take that back and grant the minimum the policies rely on.
-- Column-level grants make cross-tenant field writes fail at the grant layer,
-- before RLS even runs (tested in 030-memberships).
-- ---------------------------------------------------------------------------

revoke all on public.organizations from anon, authenticated;
revoke all on public.memberships from anon, authenticated;

-- anon keeps the read grant; every policy above is `to authenticated`, so
-- anon always reads zero rows. Denying the grant outright would make anon
-- SELECTS raise 42501 instead of returning empty (grants are checked before
-- RLS) — empties are both the friendlier API contract and the model Phase 1
-- established for profiles via default privileges.
grant select on public.organizations to anon;
grant select on public.memberships to anon;

grant select, insert on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

grant select, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;
-- no insert grant: joins happen only via accept_invitation (definer)
