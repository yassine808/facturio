-- RLS matrix for public.profiles.
-- Personas: anon, outsider (authenticated, other user), owner.
-- The runner is a superuser (bypasses RLS) — every assertion therefore runs
-- under an explicit role + JWT claims, or it proves nothing.

begin;

select plan(12);

-- ---------- setup (superuser) ----------
select tests.create_user('[email protected]') as alice \gset
select tests.create_user('[email protected]') as bob \gset

-- trigger must have auto-created exactly one profile per user
select is(
  (select count(*)::int from public.profiles),
  2,
  'setup: signup trigger created a profile for each user'
);

-- RLS is enabled (catalog check — a missing ENABLE = readable by the world)
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'SECURITY: RLS enabled on profiles'
);

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select id from public.profiles $$,
  'SECURITY: anon sees no profiles'
);

select tests.clear_authentication();

-- ---------- alice (owner of her row) ----------
select tests.authenticate_as('[email protected]');

select is(
  (select count(*)::int from public.profiles),
  1,
  'alice sees exactly her own profile'
);

select is(
  (select id from public.profiles),
  tests.user_id('[email protected]'),
  'alice sees exactly her row'
);

select is_empty(
  $$ select id from public.profiles where id = tests.user_id('[email protected]') $$,
  "SECURITY: alice cannot see bob's profile"
);

-- update own row: allowed, 1 row affected
select results_eq(
  $$ update public.profiles set display_name = 'Alice A' returning 1 $$,
  $$ values (1) $$,
  'alice can update her own profile'
);

-- update bob's row: USING filters it out → 0 rows, no error
select results_eq(
  $$ update public.profiles set display_name = 'hacked'
     where id = tests.user_id('[email protected]') returning 1 $$,
  $$ values (0) $$,
  "SECURITY: alice cannot update bob's profile (0 rows)"
);

-- insert a row for bob: WITH CHECK rejects → SQLSTATE 42501
select throws_ok(
  $$ insert into public.profiles (id, display_name)
     values (tests.user_id('[email protected]'), 'evil') $$,
  '42501',
  null,
  "SECURITY: alice cannot insert a profile for bob"
);

-- delete own row: no DELETE policy → filtered out, profile survives
select results_eq(
  $$ delete from public.profiles where id = tests.user_id('[email protected]') returning 1 $$,
  $$ values (0) $$,
  'SECURITY: profile delete is denied via API (no policy)'
);

select tests.clear_authentication();

-- ---------- bob sees only his row too ----------
select tests.authenticate_as('[email protected]');

select is(
  (select count(*)::int from public.profiles),
  1,
  "bob sees exactly his own profile (alice's hidden)"
);

select tests.clear_authentication();

select * from finish();

rollback;
