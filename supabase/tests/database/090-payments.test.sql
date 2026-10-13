-- Behavior matrix for public.payments: the sent-only payment lifecycle,
-- the auto sent -> paid flip on full coverage, and the cross-tenant
-- composite-FK attack case from PLAN 6.3.

begin;

select plan(17);

-- ---------- setup ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('dave');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.payments'::regclass),
  'SECURITY: RLS enabled on payments'
);

select tests.authenticate_as(current_setting('test.alice_email'));
insert into public.organizations (name, slug) values ('Acme', 'acme');
insert into public.clients (org_id, name)
values ((select id from public.organizations where slug = 'acme'), 'Acme Corp');
select tests.clear_authentication();

-- dave's invoice is SENT during setup: the composite-FK attack case below
-- must fail with 23503, not trip the draft-status guard first.
select tests.authenticate_as(current_setting('test.dave_email'));
insert into public.organizations (name, slug) values ('DaveCo', 'daveco');
insert into public.clients (org_id, name)
values ((select id from public.organizations where slug = 'daveco'), 'Dave Client');
insert into public.invoices (org_id, client_id)
values ((select id from public.organizations where slug = 'daveco'),
        (select id from public.clients where name = 'Dave Client'));
update public.invoices set status = 'sent';
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
  'test.invoice_b',
  (select id::text from public.invoices
   where client_id = (select id from public.clients where name = 'Dave Client')),
  true
);

-- ---------- alice: sent-only lifecycle ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

-- Same outsider-proofing as 080: stash the invoice id in a GUC, because the
-- outsider's RLS hides org A rows and a subquery there would bind null.
select set_config(
  'test.invoice_a',
  (select id::text from public.invoices
   where client_id = current_setting('test.client_a')::uuid),
  true
);

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices where client_id = current_setting('test.client_a')::uuid),
        'Design', 1, 10000);

select throws_ok(
  $$ insert into public.payments (org_id, invoice_id, amount_minor)
     values (current_setting('test.org_a_id')::uuid,
             (select id from public.invoices
              where client_id = current_setting('test.client_a')::uuid),
             10000) $$,
  'P0001',
  'payments can only be recorded or corrected while the invoice is sent',
  'no payments against a draft invoice'
);

select throws_ok(
  $$ insert into public.payments (org_id, invoice_id, amount_minor)
     values (current_setting('test.org_a_id')::uuid,
             (select id from public.invoices
              where client_id = current_setting('test.client_a')::uuid),
             0) $$,
  '23514',
  null,
  'a payment must be strictly positive'
);

select throws_ok(
  $$ insert into public.payments (org_id, invoice_id, amount_minor, paid_at)
     values (current_setting('test.org_a_id')::uuid,
             (select id from public.invoices
              where client_id = current_setting('test.client_a')::uuid),
             1000, current_date + 1) $$,
  '23514',
  null,
  'a payment cannot be dated in the future'
);

update public.invoices set status = 'sent'
where client_id = current_setting('test.client_a')::uuid;

insert into public.payments (org_id, invoice_id, amount_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices
         where client_id = current_setting('test.client_a')::uuid),
        4000);

select is(
  (select count(*)::int from public.invoices where status = 'sent'),
  1,
  'a partial payment leaves the invoice sent'
);

select is(
  (select count(*)::int from public.payments
   where invoice_id = (select id from public.invoices
                       where client_id = current_setting('test.client_a')::uuid)),
  1,
  'the partial payment is recorded'
);

insert into public.payments (org_id, invoice_id, amount_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices
         where client_id = current_setting('test.client_a')::uuid),
        6000);

select is(
  (select count(*)::int from public.invoices where status = 'paid'),
  1,
  'coverage in full flips the invoice sent -> paid automatically'
);

select throws_ok(
  $$ insert into public.payments (org_id, invoice_id, amount_minor)
     values (current_setting('test.org_a_id')::uuid,
             (select id from public.invoices
              where client_id = current_setting('test.client_a')::uuid),
             1) $$,
  'P0001',
  'payments can only be recorded or corrected while the invoice is sent',
  'an already-paid invoice accepts no more payments'
);

select throws_ok(
  $$ delete from public.payments
     where invoice_id = (select id from public.invoices
                         where client_id = current_setting('test.client_a')::uuid) $$,
  'P0001',
  'payments can only be recorded or corrected while the invoice is sent',
  'the paid invoice''s payment history is frozen'
);

select throws_ok(
  $$ update public.payments set amount_minor = 1 $$,
  '42501',
  null,
  'SECURITY: payments are corrected by delete + re-record, never in place'
);

-- Manual sent -> paid, no payment row (settled outside the tracker).
insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

update public.invoices set status = 'sent'
where client_id = current_setting('test.client_a')::uuid and status = 'draft';

update public.invoices set status = 'paid'
where client_id = current_setting('test.client_a')::uuid and status = 'sent'
  and total_minor = 0;

select is(
  (select count(*)::int from public.invoices where status = 'paid'),
  2,
  'the explicit sent -> paid transition works without a payment row'
);

-- invoice3: what bob records a payment against.
insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices
         where client_id = current_setting('test.client_a')::uuid and status = 'draft'),
        'Hosting', 1, 5000);

select tests.clear_authentication();

-- ---------- bob: member records a payment ----------
select tests.authenticate_as(current_setting('test.bob_email'));

update public.invoices set status = 'sent'
where client_id = current_setting('test.client_a')::uuid and status = 'draft';

insert into public.payments (org_id, invoice_id, amount_minor, notes)
values (current_setting('test.org_a_id')::uuid,
        (select id from public.invoices
         where client_id = current_setting('test.client_a')::uuid
           and total_minor = 5000),
        5000, 'bob settled');

select is(
  (select count(*)::int from public.payments where notes = 'bob settled'),
  1,
  'member records a payment against a sent invoice'
);

select is(
  (select count(*)::int from public.invoices where status = 'paid'),
  3,
  'the member''s full payment flips the invoice to paid'
);

-- The PLAN 6.3 attack case: happy RLS (bob is in org A) but the payment
-- points at another org's invoice — the composite FK must reject it.
select throws_ok(
  $$ insert into public.payments (org_id, invoice_id, amount_minor)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.invoice_b')::uuid, 100) $$,
  '23503',
  null,
  'SECURITY: a payment cannot reference another org''s invoice (composite FK)'
);

select tests.clear_authentication();

-- ---------- dave: outsider ----------
select tests.authenticate_as(current_setting('test.dave_email'));

select is_empty(
  $$ select 1 from public.payments $$,
  'SECURITY: outsider sees no payments of another org'
);

select throws_ok(
  $$ insert into public.payments (org_id, invoice_id, amount_minor)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.invoice_a')::uuid,
             1) $$,
  '42501',
  null,
  'SECURITY: outsider cannot record a payment inside another org'
);

select tests.clear_authentication();

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select 1 from public.payments $$,
  'SECURITY: anon reads zero rows'
);

select tests.clear_authentication();

select * from finish();
rollback;
