-- RLS matrix for public.clients.
-- Personas: alice (owner, org A), bob (member, org A), dave (outsider with his
-- own org B), anon. All DML runs top-level; effects asserted with follow-up
-- SELECTs (see 010-profiles header for the data-modifying-CTE rule).

begin;

select plan(12);

-- ---------- setup (superuser) ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('dave');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.clients'::regclass),
  'SECURITY: RLS enabled on clients'
);

-- Orgs must be created under their persona (the bootstrap trigger needs
-- auth.uid()); both happen before any client rows exist.
select tests.authenticate_as(current_setting('test.alice_email'));
insert into public.organizations (name, slug) values ('Acme', 'acme');
select tests.clear_authentication();

select tests.authenticate_as(current_setting('test.dave_email'));
insert into public.organizations (name, slug) values ('DaveCo', 'daveco');
select tests.clear_authentication();

-- Superuser: bob joins org A; remember both org ids in transaction-local GUCs
-- so persona blocks can reference the "other" tenant without a RLS-filtered
-- subquery (which would come back null and silently skip the DML).
insert into public.memberships (org_id, user_id, role)
select id, tests.user_id(current_setting('test.bob_email')), 'member'
from public.organizations where slug = 'acme';

select set_config(
  'test.org_a_id',
  (select id::text from public.organizations where slug = 'acme'),
  true
);
select set_config(
  'test.org_b_id',
  (select id::text from public.organizations where slug = 'daveco'),
  true
);

-- ---------- alice: owner ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.clients (org_id, name)
values (current_setting('test.org_a_id')::uuid, 'Acme Corp');

select is(
  (select count(*)::int from public.clients),
  1,
  'owner creates a client in her org and sees it'
);

update public.clients set name = 'Acme Corporation' where name = 'Acme Corp';

select is(
  (select name from public.clients),
  'Acme Corporation',
  'owner can rename a client'
);

update public.clients set archived_at = now() where name = 'Acme Corporation';

select is(
  (select count(*)::int from public.clients where archived_at is not null),
  1,
  'owner can archive a client'
);

select throws_ok(
  $$ delete from public.clients $$,
  '42501',
  null,
  'SECURITY: clients cannot be deleted (archive instead)'
);

select throws_ok(
  $$ update public.clients set org_id = current_setting('test.org_b_id')::uuid $$,
  '42501',
  null,
  'SECURITY: a client cannot move to another tenant (org_id has no update grant)'
);

select tests.clear_authentication();

-- ---------- bob: member ----------
select tests.authenticate_as(current_setting('test.bob_email'));

insert into public.clients (org_id, name, email)
values (current_setting('test.org_a_id')::uuid, 'Beta LLC', 'billing@beta.example');

select is(
  (select count(*)::int from public.clients),
  1,
  'member creates a client and sees exactly it'
);

update public.clients set address = '1 Way Street' where name = 'Beta LLC';

select is(
  (select count(*)::int from public.clients where address = '1 Way Street'),
  1,
  'member can edit client details'
);

select tests.clear_authentication();

-- ---------- dave: outsider ----------
select tests.authenticate_as(current_setting('test.dave_email'));

select is_empty(
  $$ select 1 from public.clients $$,
  'SECURITY: outsider sees no clients of another org'
);

select throws_ok(
  $$ insert into public.clients (org_id, name)
     values (current_setting('test.org_a_id')::uuid, 'Hax') $$,
  '42501',
  null,
  'SECURITY: outsider cannot create a client inside another org'
);

select tests.clear_authentication();

-- Positive control for the previous assertion: the rejected insert left no
-- row behind (WITH CHECK violation aborts the insert entirely).
select is(
  (select count(*)::int from public.clients),
  2,
  'the cross-org insert created nothing'
);

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select 1 from public.clients $$,
  'SECURITY: anon reads zero rows'
);

select tests.clear_authentication();

select * from finish();
rollback;
