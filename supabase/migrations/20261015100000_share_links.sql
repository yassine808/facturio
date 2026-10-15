-- 008: share links — public, read-only, revocable access to ONE issued
-- invoice (ADR-0012).
--
-- Only the sha256 of the token is stored; the raw token leaves the system
-- once, in the share URL — the same rule as invitations. The public page
-- never reads tenant tables: it calls shared_invoice() below, a single
-- SECURITY DEFINER function granted to anon, so "what does the public
-- see" is one auditable projection and one WHERE clause (hash + not
-- revoked + not expired + issued status), not per-table anon policies.
--
-- Links exist only for issued invoices: a draft has no bill behind it, and
-- a void invoice was never (or is no longer) owed. Enforced by trigger,
-- for every role — superuser fixtures included.

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null,
  -- Composite FK (house pattern): a link can never out-live its tenant or
  -- point at another tenant's invoice.
  constraint share_links_invoice_same_org
    foreign key (invoice_id, org_id)
    references public.invoices (id, org_id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.share_links is
  'Public share links for issued invoices; token stored hashed, revoked_at ends access, 30-day default expiry set by the app.';

create index share_links_invoice_idx on public.share_links (org_id, invoice_id);

-- ---------------------------------------------------------------------------
-- Issued-only rule. SECURITY DEFINER: the invoice row may be invisible to
-- the inserting role's RLS in adversarial setups, and the rule must hold
-- for every role anyway. A missing (invoice_id, org_id) pair is the
-- composite FK's own 23503 — not handled here.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_shareable_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status
    from public.invoices
   where id = new.invoice_id and org_id = new.org_id;

  -- not found: let the composite FK raise its own error below.
  if v_status is not null and v_status not in ('sent', 'paid') then
    raise exception 'share links exist for sent invoices only — issue the invoice first'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger share_links_shareable_status
  before insert on public.share_links
  for each row execute function public.enforce_shareable_invoice();

-- ---------------------------------------------------------------------------
-- The public read surface: exactly one function, granted to anon only.
-- Returns a fixed projection (org name; issued invoice fields; client
-- name; line items) or null — wrong, expired, revoked, and nonexistent
-- tokens are indistinguishable, so the endpoint is no token oracle.
-- ---------------------------------------------------------------------------

create or replace function public.shared_invoice(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'invoice', jsonb_build_object(
      'number', i.number,
      'status', i.status::text,
      'currency', i.currency::text,
      'issue_date', i.issue_date,
      'due_date', i.due_date,
      'subtotal_minor', i.subtotal_minor,
      'tax_rate_bps', i.tax_rate_bps,
      'tax_minor', i.tax_minor,
      'total_minor', i.total_minor
    ),
    'client', jsonb_build_object('name', c.name),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'description', it.description,
          'quantity', it.quantity,
          'unit_price_minor', it.unit_price_minor,
          'line_total_minor', it.line_total_minor
        )
        order by it.position, it.id
      )
      from public.invoice_items it
      where it.invoice_id = i.id and it.org_id = i.org_id
    ), '[]'::jsonb)
  )
  from public.share_links s
  join public.invoices i
    on i.id = s.invoice_id and i.org_id = s.org_id
  join public.organizations o on o.id = i.org_id
  join public.clients c
    on c.id = i.client_id and c.org_id = i.org_id
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and i.status in ('sent', 'paid');
$$;

revoke execute on function public.shared_invoice(text) from public, authenticated;
grant execute on function public.shared_invoice(text) to anon;

-- ---------------------------------------------------------------------------
-- RLS + grants: members manage links on their own org's invoices (creating
-- and emailing an invoice are the same authority, ADR-0012); anon gets
-- ZERO table grants — the RPC above is its only door. No delete grant:
-- a link is revoked, never deleted (the row is the audit trail).
-- ---------------------------------------------------------------------------

alter table public.share_links enable row level security;

create policy "share_links_select"
  on public.share_links for select
  to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[]));

create policy "share_links_insert"
  on public.share_links for insert
  to authenticated
  with check (
    public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[])
    and created_by = (select auth.uid())
    and expires_at > now()
    and revoked_at is null
  );

create policy "share_links_update"
  on public.share_links for update
  to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'member']::public.org_role[]));

revoke all on public.share_links from anon, authenticated, service_role;
grant select, insert on public.share_links to authenticated;
-- Column-level update grant: revocation is the only field a member may
-- touch — token_hash, expiry, and org linkage are immutable from the app.
grant update (revoked_at) on public.share_links to authenticated;
