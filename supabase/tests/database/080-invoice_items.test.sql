-- Behavior matrix for public.invoice_items: DB-computed money with the
-- documented rounding rule, draft-only editability, and the composite-FK
-- cross-tenant attack case from PLAN 6.3.

begin;

select plan(21);

-- ---------- setup ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('dave');

select tests.authenticate_as(current_setting('test.alice_email'));
insert into public.organizations (name, slug) values ('Acme', 'acme');
insert into public.clients (org_id, name)
values ((select id from public.organizations where slug = 'acme'), 'Acme Corp');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('test.dave_email'));
insert into public.organizations (name, slug) values ('DaveCo', 'daveco');
insert into public.clients (org_id, name)
values ((select id from public.organizations where slug = 'daveco'), 'Dave Client');
insert into public.invoices (org_id, client_id)
values ((select id from public.organizations where slug = 'daveco'),
        (select id from public.clients where name = 'Dave Client'));
select tests.clear_authentication();

insert into public.memberships (org_id, user_id, role)
select id, tests.user_id(current_setting('test.bob_email')), 'member'
from public.organizations where slug = 'acme';

select set_config(
  'test.org_a_id',
  (select id::text from public.organizations where slug = 'acme'),
  true
);
select set_config(
  'test.client_a',
  (select id::text from public.clients where name = 'Acme Corp'),
  true
);
select set_config(
  'test.client_b',
  (select id::text from public.clients where name = 'Dave Client'),
  true
);
select set_config(
  'test.invoice_b',
  (select id::text from public.invoices
   where client_id = (select id from public.clients where name = 'Dave Client')),
  true
);

-- ---------- alice: the money pipeline ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.invoices (org_id, client_id, tax_rate_bps)
values (current_setting('test.org_a_id')::uuid,
        current_setting('test.client_a')::uuid, 2000);

-- Alice remembers her invoice id in a GUC: the outsider blocks below cannot
-- resolve it with a subquery (their RLS hides org A), which would silently
-- bind a null and turn the intended 42501 into a 23502 not-null violation.
select set_config(
  'test.invoice_a',
  (select id::text from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  true
);

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices where client_id = current_setting('test.client_a')::uuid),
        'Design', 2, 10000);

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices where client_id = current_setting('test.client_a')::uuid),
        'Consulting', 1.5, 9999);

select is(
  (select line_total_minor from public.invoice_items where description = 'Design'),
  20000,
  'line total = quantity * unit_price'
);

select is(
  (select line_total_minor from public.invoice_items where description = 'Consulting'),
  14999,
  'rounding is half away from zero (1.5 * 9999 = 14998.5 -> 14999)'
);

select is(
  (select subtotal_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  34999,
  'subtotal = sum of line totals'
);

select is(
  (select tax_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  7000,
  'tax applies the same rounding rule (34999 * 20% = 6999.8 -> 7000)'
);

select is(
  (select total_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  41999,
  'total = subtotal + tax'
);

update public.invoice_items set quantity = 3 where description = 'Design';

select is(
  (select total_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  53999,
  'editing a line recomputes the invoice totals'
);

delete from public.invoice_items where description = 'Consulting';

select is(
  (select subtotal_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  30000,
  'deleting a line recomputes the subtotal'
);

select is(
  (select total_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  36000,
  'deleting a line recomputes the total'
);

update public.invoices set tax_rate_bps = 1000
where client_id = current_setting('test.client_a')::uuid;

select is(
  (select tax_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  3000,
  'changing the tax rate recomputes tax from the stored subtotal'
);

select is(
  (select total_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  33000,
  'changing the tax rate recomputes the total'
);

select throws_ok(
  $$ update public.invoice_items set line_total_minor = 1
     where description = 'Design' $$,
  '42501',
  null,
  'SECURITY: line_total is trigger-computed only (no update grant)'
);

-- ---------- items are immutable once sent ----------
update public.invoices set status = 'sent'
where client_id = current_setting('test.client_a')::uuid;

select throws_ok(
  $$ insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
     values (current_setting('test.org_a_id')::uuid,
             (select id from public.invoices where client_id = current_setting('test.client_a')::uuid),
             'Sneaky', 1, 1) $$,
  'P0001',
  'invoice items can only be edited while the invoice is a draft',
  'no new lines on a sent invoice'
);

select throws_ok(
  $$ update public.invoice_items set quantity = 99
     where description = 'Design' $$,
  'P0001',
  'invoice items can only be edited while the invoice is a draft',
  'no edits on a sent invoice'
);

select throws_ok(
  $$ delete from public.invoice_items where description = 'Design' $$,
  'P0001',
  'invoice items can only be edited while the invoice is a draft',
  'no deletions on a sent invoice'
);

select is(
  (select total_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  33000,
  'the rejected edits left the sent invoice''s totals untouched'
);

select tests.clear_authentication();

-- ---------- bob: member edits draft lines ----------
select tests.authenticate_as(current_setting('test.bob_email'));

insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices
         where client_id = current_setting('test.client_a')::uuid and status = 'draft'),
        'Hosting', 4, 2500);

select is(
  (select line_total_minor from public.invoice_items where description = 'Hosting'),
  10000,
  'member adds a line to a draft invoice'
);

update public.invoice_items set quantity = 5 where description = 'Hosting';

select is(
  (select total_minor from public.invoices
   where client_id = current_setting('test.client_a')::uuid and status = 'draft'),
  12500,
  'member edit recomputes totals (no tax on this draft)'
);

-- The PLAN 6.3 attack case: a happy RLS (bob is in org A) but the item
-- points at another org's invoice — the composite FK must reject it.
select throws_ok(
  $$ insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.invoice_b')::uuid, 'Hax', 1, 1) $$,
  '23503',
  null,
  'SECURITY: an item cannot reference another org''s invoice (composite FK)'
);

select tests.clear_authentication();

-- ---------- dave: outsider ----------
select tests.authenticate_as(current_setting('test.dave_email'));

select is_empty(
  $$ select 1 from public.invoice_items $$,
  'SECURITY: outsider sees no items of another org'
);

select throws_ok(
  $$ insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.invoice_a')::uuid,
             'Hax', 1, 1) $$,
  '42501',
  null,
  'SECURITY: outsider cannot add items to another org''s invoice'
);

select tests.clear_authentication();

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select 1 from public.invoice_items $$,
  'SECURITY: anon reads zero rows'
);

select tests.clear_authentication();

select * from finish();
rollback;
