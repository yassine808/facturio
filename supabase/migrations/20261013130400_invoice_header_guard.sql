-- 0009: freeze invoice details once the invoice leaves draft.
--
-- The grants allow members to update header columns (they must — drafts are
-- edited through them), and the status guard only constrains status moves.
-- Without this, a sent invoice's client, currency, tax rate, dates, or notes
-- could still be rewritten: the record of what was billed would stop being a
-- record. Sent/paid/void invoices accept exactly one kind of change: status.

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
    if old.status <> 'draft' then
      -- Row-wise IS DISTINCT FROM is null-safe: a draft that never got a
      -- due_date can still have one set... but only while it is a draft.
      if (new.client_id, new.currency, new.tax_rate_bps,
          new.issue_date, new.due_date, new.notes)
         is distinct from
         (old.client_id, old.currency, old.tax_rate_bps,
          old.issue_date, old.due_date, old.notes) then
        raise exception 'invoice details are frozen once sent';
      end if;
      return new;
    end if;

    -- Draft-only edits: keep tax/total honest when the rate moves.
    if new.tax_rate_bps <> old.tax_rate_bps then
      new.tax_minor := round(new.subtotal_minor * new.tax_rate_bps / 10000.0)::bigint;
      new.total_minor := new.subtotal_minor + new.tax_minor;
    end if;
    return new;
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
