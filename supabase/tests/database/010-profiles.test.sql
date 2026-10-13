-- RLS matrix for public.profiles.
-- Personas: anon, outsider (authenticated, other user), owner.
-- The runner is a superuser (bypasses RLS) — every assertion therefore runs
-- under an explicit role + JWT claims, or it proves nothing.
-- Row counts after DML are asserted with a follow-up SELECT: PostgreSQL only
-- allows data-modifying WITH clauses at the TOP level of a statement, so
-- `is((with r as (update ...)) ...)` is invalid SQL. Instead each DML runs as
-- its own top-level statement (RLS filters it silently to 0 rows when denied)
-- and the resulting state is checked afterwards.
-- Users are created via tests.make_user (run-unique emails, no deletes —
-- see 000-setup for why deletes are banned against auth.users).

begin;

select plan(11);

-- ---------- setup (superuser) ----------
select tests.make_user('alice');
select tests.make_user('bob');

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
select tests.authenticate_as(current_setting('test.alice_email'));

select is(
  (select count(*)::int from public.profiles),
  1,
  'alice sees exactly her own profile'
);

select is(
  (select id from public.profiles),
  tests.user_id(current_setting('test.alice_email')),
  'alice sees exactly her row'
);

select is_empty(
  $$ select id from public.profiles
     where id = tests.user_id(current_setting('test.bob_email')) $$,
  'SECURITY: alice cannot see bob''s profile'
);

-- update own row: allowed (policy USING = id), row must change
update public.profiles
   set display_name = 'Alice A'
 where id = tests.user_id(current_setting('test.alice_email'));

select is(
  (select display_name from public.profiles
    where id = tests.user_id(current_setting('test.alice_email'))),
  'Alice A',
  'alice can update her own profile'
);

-- update bob's row: RLS USING filters it out -> 0 rows, no error.
-- Verified globally after the persona blocks ('hacked' must exist nowhere).
update public.profiles
   set display_name = 'hacked'
 where id = tests.user_id(current_setting('test.bob_email'));

-- insert a row for bob: WITH CHECK rejects -> SQLSTATE 42501
select throws_ok(
  $$ insert into public.profiles (id, display_name)
     values (tests.user_id(current_setting('test.bob_email')), 'evil') $$,
  '42501',
  null,
  'SECURITY: alice cannot insert a profile for bob'
);

-- delete own row: no DELETE policy -> filtered out, profile survives
delete from public.profiles
 where id = tests.user_id(current_setting('test.alice_email'));

select is(
  (select count(*)::int from public.profiles
    where id = tests.user_id(current_setting('test.alice_email'))),
  1,
  'SECURITY: profile delete is denied via API (no policy)'
);

select tests.clear_authentication();

-- ---------- bob sees only his row too ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select count(*)::int from public.profiles),
  1,
  'bob sees exactly his own profile (alice''s hidden)'
);

select tests.clear_authentication();

-- ---------- superuser: global post-conditions ----------
select is(
  (select count(*)::int from public.profiles where display_name = 'hacked'),
  0,
  'SECURITY: alice update targeting bob''s profile affected no row'
);

select * from finish();

rollback;
