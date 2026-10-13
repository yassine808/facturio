-- RLS matrix for public.profiles.
-- Personas: anon, outsider (authenticated, other user), owner.
-- The runner is a superuser (bypasses RLS) — every assertion therefore runs
-- under an explicit role + JWT claims, or it proves nothing.
-- Row-count assertions use WITH ... RETURNING + count: results_eq against
-- `values (0)` would compare an empty set with {(0)} and always fail.

begin;

select plan(12);

-- ---------- setup (superuser) ----------
-- per-step diagnostics (TAP comments, no assertions): previous CI runs showed
-- the second create_user call silently producing no row, so every step of
-- setup reports the state it produced.
select tests.create_user('[email protected]');
select diag(
  'AFTER alice: users=' || (select count(*)::text from auth.users)
  || ' profiles=' || (select count(*)::text from public.profiles)
);

select tests.create_user('[email protected]');
select diag(
  'AFTER bob: users=' || (select count(*)::text from auth.users)
  || ' profiles=' || (select count(*)::text from public.profiles)
  || ' bob=' || coalesce(
       (select id::text from auth.users where email = '[email protected]'),
       'MISSING')
);

-- isolate helper vs platform: identical insert without the function wrapper
insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), '[email protected]', '{}'::jsonb);
select diag(
  'AFTER raw bob: users=' || (select count(*)::text from auth.users)
  || ' bob=' || coalesce(
       (select id::text from auth.users where email = '[email protected]'),
       'MISSING')
);

-- both users must exist before we count their profiles
select is(
  (select count(*)::int from auth.users),
  2,
  'setup: two users in auth.users'
);

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
select tests.authenticate_as('[email protected]');

select is(
  (select count(*)::int from public.profiles),
  1,
  'alice sees exactly her own profile'
);

select is(
  (select id from public.profiles),
  tests.user_id('[email protected]'),
  'alice sees exactly her row'
);

select is_empty(
  $$ select id from public.profiles where id = tests.user_id('[email protected]') $$,
  'SECURITY: alice cannot see bob''s profile'
);

-- update own row: allowed, 1 row affected
select is(
  (with r as (
     update public.profiles set display_name = 'Alice A' returning 1
   ) select count(*)::int from r),
  1,
  'alice can update her own profile'
);

-- update bob's row: USING filters it out → 0 rows, no error
select is(
  (with r as (
     update public.profiles set display_name = 'hacked'
     where id = tests.user_id('[email protected]')
     returning 1
   ) select count(*)::int from r),
  0,
  'SECURITY: alice cannot update bob''s profile (0 rows)'
);

-- insert a row for bob: WITH CHECK rejects → SQLSTATE 42501
select throws_ok(
  $$ insert into public.profiles (id, display_name)
     values (tests.user_id('[email protected]'), 'evil') $$,
  '42501',
  null,
  'SECURITY: alice cannot insert a profile for bob'
);

-- delete own row: no DELETE policy → filtered out, profile survives
select is(
  (with r as (
     delete from public.profiles
     where id = tests.user_id('[email protected]')
     returning 1
   ) select count(*)::int from r),
  0,
  'SECURITY: profile delete is denied via API (no policy)'
);

select tests.clear_authentication();

-- ---------- bob sees only his row too ----------
select tests.authenticate_as('[email protected]');

select is(
  (select count(*)::int from public.profiles),
  1,
  'bob sees exactly his own profile (alice''s hidden)'
);

select tests.clear_authentication();

select * from finish();

rollback;
