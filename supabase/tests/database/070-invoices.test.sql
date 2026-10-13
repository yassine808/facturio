-- RLS + behavior matrix for public.invoices and the numbering scheme.
-- Personas: alice (owner, org A), bob (member, org A), dave (outsider, org
-- B), anon. Covers the PLAN 6.3 attack cases: cross-org child rows (the
-- composite FK must reject them) and cross-tenant writes, plus the R6
-- gap-free numbering property via savepoint rollback.

begin;

select plan(22);

-- ---------- setup ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('dave');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass),
  'SECURITY: RLS enabled on invoices'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.invoice_counters'::regclass),
  'SECURITY: RLS enabled on invoice_counters'
);

-- Both orgs are created under their persona (bootstrap trigger needs
-- auth.uid()); each creator also makes the client their invoices point at.
select tests.authenticate_as(current_setting('test.alice_email'));
insert into public.organizations (name, slug) values ('Acme', 'acme');
insert into public.clients (org_id, name)
values ((select id from public.organizations where slug = 'acme'), 'Acme Corp');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('test.dave_email'));
insert into public.organizations (name, slug) values ('DaveCo', 'daveco');
insert into public.clients (org_id, name)
values ((select id from public.organizations where slug = 'daveco'), 'Dave Client');
select tests.clear_authentication();

-- Superuser: bob joins org A; ids go into transaction-local GUCs so persona
-- blocks can reference the "other" tenant without a RLS-filtered subquery.
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

-- ---------- alice: numbering + transitions ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

select is(
  (select number is null and status = 'draft' from public.invoices),
  true,
  'a new invoice is an unnumbered draft'
);

insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

update public.invoices set status = 'sent'
where id in (select id from public.invoices order by created_at limit 1);

select like(
  (select number from public.invoices where number is not null),
  '^INV-[0-9]{4}-0001$',
  'sending allocates INV-YYYY-0001'
);

select ok(
  (select count(*) = 1 from public.invoices where sent_at is not null and number is not null),
  'sending stamps sent_at on exactly the sent invoice'
);

update public.invoices set status = 'sent'
where number is null and status = 'draft';

select is(
  (select count(*)::int from public.invoices where number is not null),
  2,
  'the second send continues the sequence (two numbers allocated)'
);

-- Gap-free proof: a send inside a savepoint that rolls back must return its
-- number to the pool for the next send.
insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

savepoint s_alloc;
update public.invoices set status = 'sent'
where id in (
  select id from public.invoices
  where number is null and status = 'draft'
  order by created_at limit 1
);
rollback to s_alloc;

update public.invoices set status = 'sent'
where id in (
  select id from public.invoices
  where number is null and status = 'draft'
  order by created_at limit 1
);

select like(
  (select max(number) from public.invoices),
  '^INV-[0-9]{4}-0003$',
  'a rolled-back send does not burn a number (gap-free)'
);

select throws_ok(
  $$ update public.invoices set status = 'draft' where status = 'sent' $$,
  'P0001',
  'invalid invoice status transition from sent to draft',
  'sent invoices cannot go back to draft'
);

select throws_ok(
  $$ update public.invoices set status = 'paid' where status = 'draft' $$,
  'P0001',
  'invalid invoice status transition from draft to paid',
  'drafts cannot jump straight to paid'
);

update public.invoices set status = 'paid'
where number like 'INV-%-0001';

select is(
  (select count(*)::int from public.invoices where status = 'paid'),
  1,
  'sent -> paid is allowed'
);

select throws_ok(
  $$ update public.invoices set status = 'void'
     where status = 'paid' and number like 'INV-%-0001' $$,
  'P0001',
  'invalid invoice status transition from paid to void',
  'paid is terminal'
);

update public.invoices set status = 'void' where status = 'draft';

select is(
  (select count(*)::int from public.invoices where status = 'void'),
  1,
  'draft -> void is allowed (abandon before sending)'
);

select throws_ok(
  $$ insert into public.invoices (org_id, client_id, status)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.client_a')::uuid,
             'sent') $$,
  'P0001',
  'invoices start as drafts — sending allocates the number',
  'invoices cannot be born non-draft'
);

select tests.clear_authentication();

-- ---------- bob: member + grants ----------
select tests.authenticate_as(current_setting('test.bob_email'));

insert into public.invoices (org_id, client_id)
values (current_setting('test.org_a_id')::uuid, current_setting('test.client_a')::uuid);

select is(
  (select count(*)::int from public.invoices
   where status = 'draft' and client_id = current_setting('test.client_a')::uuid),
  1,
  'member can draft an invoice for a client'
);

-- The PLAN 6.3 attack case: a child row under another tenant's parent. RLS
-- is happy (bob is in org A) — the composite FK must be what rejects it.
select throws_ok(
  $$ insert into public.invoices (org_id, client_id)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.client_b')::uuid) $$,
  '23503',
  null,
  'SECURITY: an invoice cannot point at another org''s client (composite FK)'
);

update public.invoices set status = 'sent'
where status = 'draft' and client_id = current_setting('test.client_a')::uuid;

select is(
  (select count(*)::int from public.invoices where number like 'INV-%-0004'),
  1,
  'member send shares the org-wide sequence (0004 allocated)'
);

select throws_ok(
  $$ update public.invoices
     set subtotal_minor = 1 where client_id = current_setting('test.client_a')::uuid $$,
  '42501',
  null,
  'SECURITY: money columns are DB-computed only (no update grant)'
);

select throws_ok(
  $$ update public.invoices set number = 'INV-2026-9999'
     where client_id = current_setting('test.client_a')::uuid $$,
  '42501',
  null,
  'SECURITY: numbers are immutable (no update grant)'
);

select throws_ok(
  $$ select 1 from public.invoice_counters $$,
  '42501',
  null,
  'SECURITY: counters are invisible to the app (no grant, zero-policy RLS)'
);

select tests.clear_authentication();

-- ---------- dave: outsider ----------
select tests.authenticate_as(current_setting('test.dave_email'));

select is_empty(
  $$ select 1 from public.invoices $$,
  'SECURITY: outsider sees no invoices of another org'
);

select throws_ok(
  $$ insert into public.invoices (org_id, client_id)
     values (current_setting('test.org_a_id')::uuid,
             current_setting('test.client_a')::uuid) $$,
  '42501',
  null,
  'SECURITY: outsider cannot create an invoice inside another org'
);

select tests.clear_authentication();

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select 1 from public.invoices $$,
  'SECURITY: anon reads zero rows'
);

select tests.clear_authentication();

select * from finish();
rollback;
