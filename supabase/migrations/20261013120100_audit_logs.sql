-- 0003: audit_logs — the append-only trail every later phase writes into.
--
-- Phase 2 records org/member/invite events; the viewer UI lands in Phase 6.
-- Members of an org can read its trail; anyone can append rows *as themselves*
-- (INSERT is constrained to actor = auth.uid() via policy AND column grants).
-- No UPDATE/DELETE: the log is immutable through the API.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,      -- dotted verb: 'org.created', 'member.invited', …
  target_type text,          -- 'organization' | 'membership' | 'invitation'
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is 'Immutable per-org event trail.';

create index audit_logs_org_created_idx
  on public.audit_logs (org_id, created_at desc);

-- Replace the bootstrap function from the previous migration so org creation
-- also writes its audit row. Same signature, same owner: CREATE OR REPLACE is
-- the idiomatic way to evolve a trigger function across migrations.
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

  insert into public.audit_logs (org_id, actor_id, action, target_type, target_id)
  values (new.id, v_uid, 'org.created', 'organization', new.id);

  return new;
end;
$$;

alter table public.audit_logs enable row level security;

create policy "audit_logs_select"
  on public.audit_logs for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "audit_logs_insert"
  on public.audit_logs for insert
  to authenticated
  with check (
    public.is_org_member(org_id)
    and actor_id = (select auth.uid())
  );

-- No UPDATE/DELETE policies: the trail is append-only via the API.

revoke all on public.audit_logs from anon, authenticated;
-- anon: read grant kept, policies are `to authenticated` (zero rows) — see
-- the organizations migration for the rationale.
grant select on public.audit_logs to anon;
grant select, insert on public.audit_logs to authenticated;
