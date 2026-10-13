-- 0006: invoices + gap-free per-org sequential numbering.
--
-- Numbering (ADR-0006): a counter row per (org, year), locked with the
-- INSERT ... ON CONFLICT inside the send transition. Concurrent sends
-- serialize on that row; a rolled-back send takes its number back with it —
-- that is what makes the sequence gap-free, not the increment itself.
-- Numbers are allocated exactly once: draft -> sent. Drafts are unnumbered,
-- so abandoned drafts can never burn a number.
--
-- Money (ADR-0003): integer minor units, DB-computed. This migration grants
-- the app no update rights on subtotal/tax/total at all — the totals are
-- recomputed from invoice_items by trigger in the next migration, and the
-- grant layer makes "hand-edit a total" impossible before RLS is even asked.
--
-- Overdue is DERIVED, never stored: status = 'sent' and due_date < today.
-- A stored status would need a scheduled job to stay true; a derivation
-- cannot go stale. The UI labels the derived state; the DB never has it.

create type public.invoice_status as enum ('draft', 'sent', 'paid', 'void');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  -- Composite FK (PLAN 5): an invoice's client must live in the invoice's
  -- org — a child row can never reference another tenant's parent.
  constraint invoices_client_same_org
    foreign key (client_id, org_id) references public.clients (id, org_id) on delete restrict,
  number text check (number is null or number ~ '^INV-[0-9]{4}-[0-9]{4,}$'),
  status public.invoice_status not null default 'draft',
  currency char(3) not null default 'MAD' check (currency in ('MAD', 'EUR', 'USD')),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  issue_date date not null default current_date,
  due_date date,
  sent_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- number and sent_at appear together or not at all; a draft has neither;
  -- sent/paid must have both (void may keep a number it earned when sent).
  check ((number is null) = (sent_at is null)),
  check (status <> 'draft' or number is null),
  check (status not in ('sent', 'paid') or number is not null),
  constraint invoices_due_date_not_before_issue
    check (due_date is null or due_date >= issue_date)
);

comment on table public.invoices is
  'Tenant invoices. Number allocated once at draft->sent; totals are DB-computed; overdue is derived (sent + due_date < today).';

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create index invoices_org_idx on public.invoices (org_id);
create index invoices_client_idx on public.invoices (client_id);

-- The composite FKs need matching unique constraints: (id, org_id), not just
-- the primary key on id. One here for clients, one below for invoices itself
-- (invoice_items references it in the next migration).
alter table public.clients
  add constraint clients_id_org_unique unique (id, org_id);

alter table public.invoices
  add constraint invoices_id_org_unique unique (id, org_id);

-- ---------------------------------------------------------------------------
-- Counters: invisible to the app on purpose. RLS enabled with zero policies
-- and zero grants — only the definer trigger below (and superuser tests)
-- can touch it. There is nothing a member could usefully read or write here.
-- ---------------------------------------------------------------------------

create table public.invoice_counters (
  org_id uuid not null references public.organizations (id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  last_number integer not null default 0 check (last_number >= 0),
  primary key (org_id, year)
);

alter table public.invoice_counters enable row level security;

-- ---------------------------------------------------------------------------
-- One rule function for insert and update (a single BEFORE trigger avoids
-- any trigger-ordering questions between validation and allocation).
-- SECURITY DEFINER: the counter insert would otherwise be filtered by the
-- counters' own zero-policy RLS for the calling role.
-- ---------------------------------------------------------------------------

create or replace function public.handle_invoice_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from new.issue_date)::integer;
  v_next integer;
begin
  if tg_op = 'INSERT' then
    -- Numbers exist only on the way out of draft (see numbering header).
    if new.status <> 'draft' then
      raise exception 'invoices start as drafts — sending allocates the number';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new; -- ordinary edit (dates, notes, client…), totals recompute
  end if;

  -- Allowed terminal transitions; void is reachable from draft and sent,
  -- paid is terminal (a paid invoice is a record, not a work item).
  if (old.status, new.status) in (
    ('draft', 'void'),
    ('sent', 'paid'),
    ('sent', 'void')
  ) then
    return new;
  end if;

  if new.status = 'sent' and old.status = 'draft' then
    -- The row lock on (org, year) serializes concurrent sends; if this
    -- transaction rolls back, the counter increment rolls back with it and
    -- the next send reuses the number — no gaps.
    insert into public.invoice_counters as c (org_id, year, last_number)
    values (new.org_id, v_year, 1)
    on conflict (org_id, year) do update
      set last_number = c.last_number + 1
    returning c.last_number into v_next;

    new.number := 'INV-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
    new.sent_at := (select now());
    return new;
  end if;

  raise exception 'invalid invoice status transition from % to %', old.status, new.status;
end;
$$;

create trigger invoices_rules
  before insert or update on public.invoices
  for each row execute function public.handle_invoice_rules();

-- ---------------------------------------------------------------------------
-- RLS: members own the working data; void instead of delete.
-- ---------------------------------------------------------------------------

alter table public.invoices enable row level security;

create policy "invoices_select"
  on public.invoices for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "invoices_insert"
  on public.invoices for insert
  to authenticated
  with check (public.is_org_member(org_id));

create policy "invoices_update"
  on public.invoices for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- No DELETE policy: void instead (invoices are financial records).

-- ---------------------------------------------------------------------------
-- Grants. The app may start drafts and drive status transitions; it may NOT
-- touch money columns, number, or sent_at — triggers own those, and a
-- trigger assignment is not privilege-checked against the caller's grants.
-- ---------------------------------------------------------------------------

revoke all on public.invoices from anon, authenticated;

grant select on public.invoices to anon;

grant select on public.invoices to authenticated;
grant insert (org_id, client_id, currency, tax_rate_bps, issue_date, due_date, notes)
  on public.invoices to authenticated;
grant update (client_id, currency, tax_rate_bps, issue_date, due_date, notes, status)
  on public.invoices to authenticated;
