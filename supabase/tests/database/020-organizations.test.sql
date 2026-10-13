-- RLS matrix for public.organizations (+ the org bootstrap trigger).
-- Personas: anon, alice (creator/owner), bob (outsider who may create his own
-- org). All DML runs top-level; effects are asserted with follow-up SELECTs
-- (see 010-profiles header for the data-modifying-CTE rule).
-- NOTE for fixture authors: inserting an organization as the superuser
-- runner raises (handle_new_organization requires auth.uid()) — create orgs
-- under a persona, never as superuser.

begin;

select plan(11);

-- ---------- setup (superuser) ----------
select tests.make_user('alice');
select tests.make_user('bob');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.organizations'::regclass),
  'SECURITY: RLS enabled on organizations'
);

-- ---------- alice creates her org ----------
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.organizations (name, slug)
values ('Acme', 'acme');

select is(
  (select count(*)::int from public.organizations),
  1,
  'alice sees the organization she created'
);

select is(
  (select count(*)::int from public.memberships where role = 'owner'),
  1,
  'bootstrap trigger made the creator the owner'
);

update public.organizations set name = 'Acme Inc' where slug = 'acme';

select is(
  (select name from public.organizations where slug = 'acme'),
  'Acme Inc',
  'owner can rename the organization'
);

select throws_ok(
  $$ update public.organizations set slug = 'acme-2' where slug = 'acme' $$,
  '42501',
  null,
  'SECURITY: organizations.slug is immutable (column-level grant)'
);

select tests.clear_authentication();

-- ---------- bob: outsider ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select count(*)::int from public.organizations),
  0,
  'SECURITY: outsider sees no organizations'
);

update public.organizations set name = 'hacked' where slug = 'acme';

-- positive control: any signed-in user may create an org of their own
insert into public.organizations (name, slug)
values ('BobCo', 'bobco');

select is(
  (select count(*)::int from public.organizations),
  1,
  'bob sees exactly his own organization'
);

select tests.clear_authentication();

select is(
  (select name from public.organizations where slug = 'acme'),
  'Acme Inc',
  'SECURITY: outsider rename attempt changed nothing'
);

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select id from public.organizations $$,
  'SECURITY: anon sees no organizations'
);

select tests.clear_authentication();

-- ---------- superuser: global post-conditions ----------
select is(
  (select count(*)::int from public.organizations),
  2,
  'setup: exactly the two created organizations exist'
);

select is(
  (select count(*)::int from public.audit_logs where action = 'org.created'),
  2,
  'bootstrap wrote an org.created audit row per organization'
);

select * from finish();

rollback;
