-- 0008: manual payments against sent invoices.
--
-- Lifecycle rule, enforced by one AFTER trigger: a payment can be recorded
-- or corrected only while its invoice is 'sent'. Recording a payment that
-- covers the total flips the invoice sent -> paid (the only forward move);
-- once paid, the payment history freezes with it — paid invoices are
-- records, not work items (consistent with handle_invoice_rules). This is
-- also why delete is granted but update is not: corrections are delete +
-- re-record while the invoice is still sent, never an in-place edit of
-- settled money.
--
-- The app also keeps an explicit sent -> paid transition for invoices
-- settled outside this table (cash, bank transfer with no per-payment
-- breakdown) — that path needs no payment row at all.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null,
  constraint payments_invoice_same_org
    foreign key (invoice_id, org_id)
    references public.invoices (id, org_id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  paid_at date not null default current_date check (paid_at <= current_date),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payments is
  'Manual payment records. Insert/delete only while the invoice is sent; recording full coverage flips the invoice to paid.';

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create index payments_invoice_idx on public.payments (invoice_id);

-- SECURITY DEFINER: reading the invoice status/total and flipping sent ->
-- paid would otherwise run against the caller's grants/RLS on invoices.
create or replace function public.handle_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  v_status public.invoice_status;
  v_total bigint;
  v_paid bigint;
begin
  select status, total_minor
    into v_status, v_total
  from public.invoices
  where id = v_invoice;

  if v_status is null then
    return null; -- invoice removed: nothing to guard (cascades are restrict here anyway)
  end if;

  if v_status <> 'sent' then
    raise exception 'payments can only be recorded or corrected while the invoice is sent';
  end if;

  select coalesce(sum(amount_minor), 0) into v_paid
  from public.payments
  where invoice_id = v_invoice;

  if v_paid >= v_total then
    -- fires handle_invoice_rules (sent -> paid is an allowed transition);
    -- a zero-total invoice with any payment also settles here.
    update public.invoices set status = 'paid' where id = v_invoice;
  end if;

  return null;
end;
$$;

create trigger payments_recompute
  after insert or update or delete on public.payments
  for each row execute function public.handle_payment_change();

-- ---------------------------------------------------------------------------
-- RLS: members own the payment records; no UPDATE at all (corrections are
-- delete + re-record while the invoice is still sent).
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;

create policy "payments_select"
  on public.payments for select
  to authenticated
  using (public.is_org_member(org_id));

create policy "payments_insert"
  on public.payments for insert
  to authenticated
  with check (public.is_org_member(org_id));

create policy "payments_delete"
  on public.payments for delete
  to authenticated
  using (public.is_org_member(org_id));

revoke all on public.payments from anon, authenticated;

grant select on public.payments to anon;

grant select, delete on public.payments to authenticated;
grant insert (org_id, invoice_id, amount_minor, paid_at, notes)
  on public.payments to authenticated;
