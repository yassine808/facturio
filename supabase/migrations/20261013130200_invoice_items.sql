-- 0007: invoice_items — the only place money enters the system.
--
-- Money rule (ADR-0003), all integer/numeric math, no floats anywhere:
--   line_total   = round(quantity * unit_price_minor)      -- per line, half away from zero
--   subtotal     = sum(line_total)
--   tax          = round(subtotal * tax_rate_bps / 10000)  -- same rounding rule
--   total        = subtotal + tax
-- Totals are recomputed by trigger on every item change, and the items of a
-- sent invoice are immutable — what was billed is what the record says, and
-- the invoice's own totals can never drift from the lines that produced it.
--
-- This migration also extends handle_invoice_rules (create or replace keeps
-- the existing trigger bound): changing tax_rate_bps on a draft recomputes
-- tax/total from the stored subtotal, closing the only drift path the item
-- trigger cannot see.

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null,
  -- Composite FK: an item can never reference another tenant's invoice.
  constraint items_invoice_same_org
    foreign key (invoice_id, org_id)
    references public.invoices (id, org_id) on delete cascade,
  description text not null check (char_length(description) between 1 and 500),
  -- Ceilings keep quantity * unit_price comfortably inside bigint; real
  -- invoices are orders of magnitude below both (math stays exact either
  -- way — an overflow raises, it never wraps).
  quantity numeric(12, 3) not null default 1 check (quantity > 0 and quantity <= 1000000),
  unit_price_minor bigint not null check (unit_price_minor >= 0 and unit_price_minor <= 1000000000000),
  position integer not null default 0,
  line_total_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoice_items is
  'Invoice line items. line_total and all invoice totals are trigger-computed; items immutable once the invoice leaves draft.';

create trigger invoice_items_set_updated_at
  before update on public.invoice_items
  for each row execute function public.set_updated_at();

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- ---------------------------------------------------------------------------
-- BEFORE: stamp the line total from the row's own inputs.
-- ---------------------------------------------------------------------------

create or replace function public.stamp_item_line_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- round(numeric) is half-away-from-zero — the documented rounding rule.
  new.line_total_minor := round(new.quantity * new.unit_price_minor)::bigint;
  return new;
end;
$$;

create trigger invoice_items_stamp
  before insert or update on public.invoice_items
  for each row execute function public.stamp_item_line_total();

-- ---------------------------------------------------------------------------
-- AFTER: guard the draft-only rule and recompute the invoice totals. Runs
-- after insert/update/delete so the changed row set is already visible.
-- SECURITY DEFINER: the invoice UPDATE below would otherwise hit the invoices'
-- own grants/RLS for the calling role on every item edit.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  v_status public.invoice_status;
  v_subtotal bigint;
  v_tax bigint;
begin
  select status into v_status from public.invoices where id = v_invoice;
  if v_status is null then
    return null; -- invoice removed by cascade: nothing left to recompute
  end if;

  -- Once an invoice is sent its lines are a financial record, not a draft.
  if v_status <> 'draft' then
    raise exception 'invoice items can only be edited while the invoice is a draft';
  end if;

  select coalesce(sum(line_total_minor), 0) into v_subtotal
  from public.invoice_items
  where invoice_id = v_invoice;

  select round(v_subtotal * i.tax_rate_bps / 10000.0)::bigint into v_tax
  from public.invoices i
  where i.id = v_invoice;

  update public.invoices
     set subtotal_minor = v_subtotal,
         tax_minor = v_tax,
         total_minor = v_subtotal + v_tax
   where id = v_invoice;

  return null;
end;
$$;

create trigger invoice_items_recompute
  after insert or update or delete on public.invoice_items
  for each row execute function public.recompute_invoice_totals();

-- ---------------------------------------------------------------------------
-- The invoice-side drift path the item trigger cannot see: tax_rate_bps
-- changing with no item change. Same rounding rule, applied in-row.
-- (create or replace keeps the existing invoices_rules trigger bound.)
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
    if new.status <> 'draft' then
      raise exception 'invoices start as drafts — sending allocates the number';
    end if;
    return new;
  end if;

  if new.status = old.status then
    if new.tax_rate_bps <> old.tax_rate_bps then
      new.tax_minor := round(new.subtotal_minor * new.tax_rate_bps / 10000.0)::bigint;
      new.total_minor := new.subtotal_minor + new.tax_minor;
    end if;
    return new; -- ordinary edit (dates, notes, client…), totals recompute
  end if;

  if (old.status, new.status) in (
    ('draft', 'void'),
    ('sent', 'paid'),
    ('sent', 'void')
  ) then
    return new;
  end if;

  if new.status = 'sent' and old.status = 'draft' then
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

-- ---------------------------------------------------------------------------
-- RLS + grants: members edit draft lines; line_total has no grant at all
-- (the BEFORE trigger sets it, and trigger assignments skip grant checks).
-- ---------------------------------------------------------------------------

alter table public.invoice_items enable row level security;

create policy "invoice_items_select"
  on public.invoice_items for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "invoice_items_insert"
  on public.invoice_items for insert
  to authenticated
  with check (public.is_org_member(org_id));

create policy "invoice_items_update"
  on public.invoice_items for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy "invoice_items_delete"
  on public.invoice_items for delete
  to authenticated
  using (public.is_org_member(org_id));

revoke all on public.invoice_items from anon, authenticated;

grant select on public.invoice_items to anon;

grant select, delete on public.invoice_items to authenticated;
grant insert (org_id, invoice_id, description, quantity, unit_price_minor, position)
  on public.invoice_items to authenticated;
grant update (description, quantity, unit_price_minor, position)
  on public.invoice_items to authenticated;
