-- 0004: invitations — expiring, single-use, email-bound org invites.
--
-- Only the sha256 of the token is stored; the raw token leaves the system
-- once, in the invite link (email delivery lands in Phase 5). Acceptance runs
-- through the SECURITY DEFINER function below, never through a direct insert
-- into memberships (see the organizations migration for why).
--
-- Status is derived, never stored: pending = accepted_at is null and
-- expires_at > now(). Revoking = deleting the row, which also frees the
-- (org_id, email) pending slot for a fresh invite.

create extension if not exists pgcrypto with schema extensions;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  -- Invited as owner happens later via in-app promotion; keeps the
  -- last-owner math out of the invite flow.
  role public.org_role not null default 'member'
    check (role in ('member', 'admin')),
  token_hash text not null unique,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.invitations is 'Pending/accepted org invites; token stored hashed.';

-- At most one *pending* invite per email per org (re-issuing requires a revoke).
create unique index invitations_pending_email_idx
  on public.invitations (org_id, email)
  where accepted_at is null;

create index invitations_org_idx on public.invitations (org_id);

-- ---------------------------------------------------------------------------
-- Acceptance: the only path from "invited" to "member" for a non-creator.
-- Returns a status row instead of raising for business failures, so the app
-- (and pgTAP) get a deterministic answer without parsing exception text:
--   accepted    -> membership created (or already existed), invite marked used
--   invalid     -> unknown token, already accepted, or expired (one message:
--                  a token is a secret; its owner may learn the reason later)
--   wrong_email -> invite is live but was issued to a different address
-- ---------------------------------------------------------------------------

create or replace function public.accept_invitation(p_token text)
returns table (status text, org_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'sign in to accept an invitation' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_inv
    from public.invitations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not found
     or v_inv.accepted_at is not null
     or v_inv.expires_at <= now() then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_inv.email <> lower(coalesce(v_email, '')) then
    return query select 'wrong_email'::text, null::uuid;
    return;
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (v_inv.org_id, v_uid, v_inv.role)
  -- conflict target by constraint name: `on conflict (org_id, user_id)` is
  -- ambiguous here because RETURNS TABLE declares an org_id OUT parameter.
  on conflict on constraint memberships_org_id_user_id_key do nothing;

  update public.invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id, metadata)
  values (v_inv.org_id, v_uid, 'member.joined', 'invitation', v_inv.id,
          jsonb_build_object('role', v_inv.role::text));

  return query select 'accepted'::text, v_inv.org_id;
end;
$$;

revoke execute on function public.accept_invitation(text) from anon, public;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: only owner/admin of the org may see or manage its invitations.
-- Recipients must NOT be able to read invitation rows before accepting (they
-- get the raw token in the link, and nothing else — tokens are hashed).
-- ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

create policy "invitations_select"
  on public.invitations for select
  to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "invitations_insert"
  on public.invitations for insert
  to authenticated
  with check (
    public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    and invited_by = (select auth.uid())
    and expires_at > now()
  );

create policy "invitations_delete"
  on public.invitations for delete
  to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- Invites are immutable: no UPDATE policy and no update grant. A revoke is a
-- delete; a new invite is a new row.

revoke all on public.invitations from anon, authenticated;
-- anon: read grant kept, policies are `to authenticated` (zero rows) — see
-- the organizations migration for the rationale.
grant select on public.invitations to anon;
grant select, insert, delete on public.invitations to authenticated;
