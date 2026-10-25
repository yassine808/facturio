-- Behavior matrix for public share links (ADR-0012): the token is a
-- secret stored as sha256; the ONLY public read is the shared_invoice()
-- definer function returning a fixed projection (no per-table anon
-- policies); links exist only for issued invoices (trigger, every role);
-- members manage links on their own org's invoices; revocation kills the
-- link on the very next read. Personas: alice (owner, org A), bob
-- (member, org A), dave (outsider, later owner of org B), anon,
-- superuser.

begin;

select plan(24);

-- ---------- setup ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('dave');

select tests.authenticate_as(current_setting('test.alice_email'));
insert into public.organizations (name, slug) values ('Acme', 'acme');

select tests.clear_authentication();

-- Superuser: bob joins org A; ids go into transaction-local GUCs so persona
-- blocks never use an RLS-filtered subquery (070 lesson).
insert into public.memberships (org_id, user_id, role)
select id, tests.user_id(current_setting('test.bob_email')), 'member'
from public.organizations where slug = 'acme';

select set_config(
  'test.org_a_id',
  (select id::text from public.organizations where slug = 'acme'),
  true
);

select tests.clear_authentication();

-- ---------- static: table and function surface ----------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.share_links'::regclass),
  'SECURITY: RLS enabled on share_links'
);

select ok(
  not has_table_privilege('anon', 'public.share_links', 'select'),
  'anon has zero grants on share_links — the rpc is its only door'
);

select ok(
  not has_table_privilege('authenticated', 'public.share_links', 'delete'),
  'links are revoked, never deleted — no delete grant'
);

select ok(
  has_function_privilege('anon', 'public.shared_invoice(text)', 'execute'),
  'anon may execute shared_invoice'
);

select ok(
  not has_function_privilege('authenticated', 'public.shared_invoice(text)', 'execute'),
  'authenticated may NOT execute shared_invoice (the app reads via RLS)'
);

-- ---------- alice: issue an invoice, mint a link ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'Acme Corp');

insert into public.invoices (org_id, client_id)
select current_setting('test.org_a_id')::uuid, id
from public.clients where name = 'Acme Corp';

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
select current_setting('test.org_a_id')::uuid, id, 'Website design', 1, 120000
from public.invoices where status = 'draft';

update public.invoices set tax_rate_bps = 2000 where status = 'draft';
update public.invoices set status = 'sent' where status = 'draft';

-- Superuser: stash the sent invoice id — the outsider block below must
-- not use an RLS-filtered subquery (070 lesson): dave sees NO invoices,
-- so a select-based insert there silently inserts zero rows and proves
-- nothing (that exact bug shipped once — see CI 38674546314).
select tests.clear_authentication();

select set_config(
  'test.sent_invoice_id',
  (select id::text from public.invoices where status = 'sent'),
  true
);

insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at)
select
  current_setting('test.org_a_id')::uuid,
  i.id,
  encode(extensions.digest('share-token-valid', 'sha256'), 'hex'),
  tests.user_id(current_setting('test.alice_email')),
  now() + interval '30 days'
from public.invoices i
where i.status = 'sent';

select ok(
  exists(select 1 from public.share_links),
  'a member mints a link for a sent invoice'
);

select is(
  (select count(*)::int from public.share_links),
  1,
  'the owner sees the org''s links'
);

-- ---------- anon: the projection ----------
select tests.clear_authentication();
select tests.authenticate_as_anon();

select is(
  public.shared_invoice('share-token-valid') ->> 'org_name',
  'Acme',
  'a valid token resolves to the org name'
);

select matches(
  public.shared_invoice('share-token-valid') -> 'invoice' ->> 'number',
  '^INV-[0-9]{4}-0001$',
  'the projection carries the issued number'
);

select is(
  jsonb_array_length(public.shared_invoice('share-token-valid') -> 'items'),
  1,
  'line items ride along'
);

select is(
  public.shared_invoice('share-token-valid') -> 'invoice' ->> 'total_minor',
  '144000',
  'money is the db-computed minor total (120000 + 20% = 144000)'
);

select is(
  public.shared_invoice('wrong-token'),
  null::jsonb,
  'an unknown token is null — no oracle'
);

-- ---------- revocation: effective on the next read ----------
select tests.clear_authentication();
select tests.authenticate_as(current_setting('test.alice_email'));

update public.share_links set revoked_at = now();

select ok(
  (select revoked_at is not null from public.share_links),
  'the owner revokes the link'
);

select tests.clear_authentication();
select tests.authenticate_as_anon();

select is(
  public.shared_invoice('share-token-valid'),
  null::jsonb,
  'a revoked link is dead on the very next read'
);

-- ---------- expiry: superuser fixture, trigger still applies ----------
select tests.clear_authentication();

insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at)
select
  current_setting('test.org_a_id')::uuid,
  i.id,
  encode(extensions.digest('share-token-expired', 'sha256'), 'hex'),
  tests.user_id(current_setting('test.alice_email')),
  now() - interval '1 second'
from public.invoices i
where i.status = 'sent';

select tests.authenticate_as_anon();

select is(
  public.shared_invoice('share-token-expired'),
  null::jsonb,
  'an expired link is dead'
);

-- ---------- issued-only rule + insert policy ----------
select tests.clear_authentication();
select tests.authenticate_as(current_setting('test.alice_email'));

-- A second invoice that stays a draft (fixtures below target it).
insert into public.invoices (org_id, client_id)
select current_setting('test.org_a_id')::uuid, id from public.clients;

select throws_ok(
  $q$ insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at)
      select current_setting('test.org_a_id')::uuid, i.id,
             encode(extensions.digest('share-token-draft', 'sha256'), 'hex'),
             tests.user_id(current_setting('test.alice_email')),
             now() + interval '30 days'
      from public.invoices i where i.status = 'draft' $q$,
  '23514',
  'share links exist for sent invoices only — issue the invoice first',
  'a draft invoice cannot get a share link (trigger, every role)'
);

select throws_ok(
  $q$ insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at, revoked_at)
      select current_setting('test.org_a_id')::uuid, i.id,
             encode(extensions.digest('share-token-born-revoked', 'sha256'), 'hex'),
             tests.user_id(current_setting('test.alice_email')),
             now() + interval '30 days', now()
      from public.invoices i where i.status = 'sent' $q$,
  '42501',
  null,
  'the with-check policy refuses links born revoked'
);

-- ---------- outsider ----------
select tests.clear_authentication();
select tests.authenticate_as(current_setting('test.dave_email'));

-- Concrete ids, no subquery: dave's row targets org A's REAL sent
-- invoice, so the composite FK would happily accept it and the ONLY
-- thing that can stop the insert is the with-check (org membership).
select throws_ok(
  $q$ insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at)
      values (current_setting('test.org_a_id')::uuid,
              current_setting('test.sent_invoice_id')::uuid,
              encode(extensions.digest('share-token-dave', 'sha256'), 'hex'),
              tests.user_id(current_setting('test.dave_email')),
              now() + interval '30 days') $q$,
  '42501',
  null,
  'an outsider cannot mint a link into another org'
);

select is_empty(
  $$ select 1 from public.share_links $$,
  'an outsider reads no links of org A'
);

-- ---------- token shape and column grants ----------
select tests.clear_authentication();
select tests.authenticate_as(current_setting('test.alice_email'));

select throws_ok(
  $q$ insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at)
      select current_setting('test.org_a_id')::uuid, i.id, 'not-a-hash',
             tests.user_id(current_setting('test.alice_email')),
             now() + interval '30 days'
      from public.invoices i where i.status = 'sent' $q$,
  '23514',
  null,
  'token_hash must look like a sha256 hex digest'
);

select throws_ok(
  $q$ update public.share_links
         set token_hash = encode(extensions.digest('rehash', 'sha256'), 'hex') $q$,
  '42501',
  null,
  'only revoked_at is updatable from the app (column-level grant)'
);

select throws_ok(
  $$ delete from public.share_links $$,
  '42501',
  null,
  'links are revoked, never deleted'
);

-- ---------- tenant boundary: org B ----------
select is_empty(
  $$ select 1 from public.share_links
      where org_id <> current_setting('test.org_a_id')::uuid $$,
  'links never cross the tenant boundary'
);

select tests.clear_authentication();
select tests.authenticate_as(current_setting('test.dave_email'));

insert into public.organizations (name, slug) values ('Globex', 'globex');

insert into public.clients (org_id, name)
select id, 'Globex Client' from public.organizations where slug = 'globex';

insert into public.invoices (org_id, client_id)
select o.id, c.id
from public.organizations o, public.clients c
where o.slug = 'globex' and c.name = 'Globex Client';

insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_minor)
select o.id, i.id, 'Consulting', 2, 50000
from public.organizations o, public.invoices i
where o.slug = 'globex' and i.org_id = o.id and i.status = 'draft';

update public.invoices set status = 'sent'
where status = 'draft'
  and org_id = (select id from public.organizations where slug = 'globex');

insert into public.share_links (org_id, invoice_id, token_hash, created_by, expires_at)
select o.id, i.id,
       encode(extensions.digest('share-token-globex', 'sha256'), 'hex'),
       tests.user_id(current_setting('test.dave_email')),
       now() + interval '30 days'
from public.organizations o, public.invoices i
where o.slug = 'globex' and i.org_id = o.id and i.status = 'sent';

select tests.clear_authentication();
select tests.authenticate_as_anon();

select is(
  public.shared_invoice('share-token-globex') ->> 'org_name',
  'Globex',
  'a valid token reads its own org — the public surface is per-token'
);

select tests.clear_authentication();

select * from finish();
rollback;
