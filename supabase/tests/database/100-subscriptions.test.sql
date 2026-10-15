-- Behavior matrix for the billing platform (ADR-0005): the free-plan row is
-- born by bootstrap, only the webhook side may ever change it, the client
-- limit trigger is the DB-level authority, and the Stripe event ledger is an
-- invisible, idempotent insert log. Personas: alice (owner, org A), bob
-- (member, org A), dave (outsider), anon, superuser (the webhook's stand-in).

begin;

select plan(24);

-- ---------- setup ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('dave');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass),
  'SECURITY: RLS enabled on subscriptions'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass),
  'SECURITY: RLS enabled on stripe_events'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_admins'::regclass),
  'SECURITY: RLS enabled on platform_admins'
);

select tests.authenticate_as(current_setting('test.alice_email'));
insert into public.organizations (name, slug) values ('Acme', 'acme');

select is(
  (select plan::text from public.subscriptions),
  'free',
  'an organization is born on the free plan'
);

select is(
  (select count(*)::int from public.subscriptions),
  1,
  'exactly one subscription row per org'
);

select tests.clear_authentication();

-- Superuser: bob joins org A; org id goes into a transaction-local GUC so
-- persona blocks never use an RLS-filtered subquery (see 070 lesson).
insert into public.memberships (org_id, user_id, role)
select id, tests.user_id(current_setting('test.bob_email')), 'member'
from public.organizations where slug = 'acme';

select set_config(
  'test.org_a_id',
  (select id::text from public.organizations where slug = 'acme'),
  true
);

select tests.clear_authentication();

-- ---------- read access ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select plan::text from public.subscriptions),
  'free',
  'a member reads the plan'
);

select tests.clear_authentication();
select tests.authenticate_as(current_setting('test.dave_email'));

select is_empty(
  $$ select 1 from public.subscriptions $$,
  'SECURITY: outsider sees no subscription of another org'
);

select tests.clear_authentication();
select tests.authenticate_as_anon();

select is_empty(
  $$ select 1 from public.subscriptions $$,
  'SECURITY: anon reads zero rows (authenticated-only policy)'
);

select tests.clear_authentication();

-- ---------- the app cannot write its own plan ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select throws_ok(
  $$ insert into public.subscriptions (org_id)
     values (current_setting('test.org_a_id')::uuid) $$,
  '42501',
  null,
  'SECURITY: the app cannot create a subscription row'
);

select throws_ok(
  $$ update public.subscriptions set plan = 'pro' $$,
  '42501',
  null,
  'SECURITY: the app cannot upgrade its own plan (no update grant)'
);

select throws_ok(
  $$ delete from public.subscriptions $$,
  '42501',
  null,
  'SECURITY: the app cannot delete the subscription row'
);

select tests.clear_authentication();

-- ---------- free plan client limit (as alice) ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'C1');
insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'C2');
insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'C3');

select is(
  (select count(*)::int from public.clients
   where org_id = current_setting('test.org_a_id')::uuid and archived_at is null),
  3,
  'free plan fits exactly three active clients'
);

select throws_ok(
  $$ insert into public.clients (org_id, name)
     values (current_setting('test.org_a_id')::uuid, 'C4') $$,
  'P0001',
  'free plan includes 3 active clients — archive one or upgrade to pro',
  'the fourth active client is rejected by the plan limit'
);

update public.clients set archived_at = now() where name = 'C1';

select is(
  (select count(*)::int from public.clients
   where org_id = current_setting('test.org_a_id')::uuid and archived_at is null),
  2,
  'archiving frees a slot'
);

insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'C4');

select is(
  (select count(*)::int from public.clients
   where org_id = current_setting('test.org_a_id')::uuid and archived_at is null),
  3,
  'a new client fits after archiving'
);

select throws_ok(
  $$ update public.clients set archived_at = null where name = 'C1' $$,
  'P0001',
  'free plan includes 3 active clients — archive one or upgrade to pro',
  'SECURITY: restore counts toward the limit too'
);

select tests.clear_authentication();

-- ---------- pro has no cap; limits return when the plan ends (superuser,
-- standing in for the webhook writer — the trigger checks the plan for
-- every role) ----------
update public.subscriptions
set plan = 'pro', stripe_subscription_id = 'sub_test_1', status = 'active'
where org_id = current_setting('test.org_a_id')::uuid;

insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'C5');

select is(
  (select count(*)::int from public.clients
   where org_id = current_setting('test.org_a_id')::uuid and archived_at is null),
  4,
  'pro orgs have no client cap'
);

update public.subscriptions
set plan = 'free', stripe_subscription_id = null, status = null
where org_id = current_setting('test.org_a_id')::uuid;

select throws_ok(
  $$ insert into public.clients (org_id, name)
     values (current_setting('test.org_a_id')::uuid, 'C6') $$,
  'P0001',
  'free plan includes 3 active clients — archive one or upgrade to pro',
  'limits apply again once the plan ends (no retroactive cleanup)'
);

select throws_ok(
  $$ update public.subscriptions set plan = 'pro'
     where org_id = current_setting('test.org_a_id')::uuid $$,
  '23514',
  null,
  'a paid plan requires its stripe subscription id (CHECK)'
);

-- ---------- event ledger ----------
insert into public.stripe_events (id, type, stripe_created_at)
values ('evt_test_1', 'checkout.session.completed', now());
insert into public.stripe_events (id, type, stripe_created_at)
values ('evt_test_2', 'customer.subscription.deleted', now());

select throws_ok(
  $$ insert into public.stripe_events (id, type)
     values ('evt_test_1', 'checkout.session.completed') $$,
  '23505',
  null,
  'a duplicate delivery is rejected by the primary key'
);

select is(
  (select count(*)::int from public.stripe_events),
  2,
  'the ledger records each event once'
);

select tests.authenticate_as(current_setting('test.bob_email'));

select throws_ok(
  $$ select 1 from public.stripe_events $$,
  '42501',
  null,
  'SECURITY: the event ledger is invisible to the app'
);

select throws_ok(
  $$ select 1 from public.platform_admins $$,
  '42501',
  null,
  'SECURITY: the platform admin table is invisible to the app'
);

select tests.clear_authentication();

-- ---------- cascade ----------
delete from public.organizations
where id = current_setting('test.org_a_id')::uuid;

select is_empty(
  $$ select 1 from public.subscriptions
     where org_id = current_setting('test.org_a_id')::uuid $$,
  'subscription rows die with their org (cascade)'
);

select tests.clear_authentication();

select * from finish();
rollback;
