-- RLS matrix for public.profiles.
-- Personas: anon, outsider (authenticated, other user), owner.
-- The runner is a superuser (bypasses RLS) — every assertion therefore runs
-- under an explicit role + JWT claims, or it proves nothing.
-- Row-count assertions use WITH ... RETURNING + count: results_eq against
-- `values (0)` would compare an empty set with {(0)} and always fail.

begin;

select plan(12);

-- ---------- setup (superuser): instrumented ----------
-- Previous runs: exactly one user ever exists after two create_user calls and
-- the surviving email varies run to run. This block reproduces the exact same
-- statements with per-step state printed (NOTICE = immediate stderr, diag =
-- TAP comment) so the mechanism is observable in one CI run.
select diag(
  'BASELINE: users=' || (select count(*)::text from auth.users)
  || ' profiles=' || (select count(*)::text from public.profiles)
);

-- verbose clone of tests.create_user (identical body + raises)
create or replace function tests.create_user_verbose(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
  v_deleted int;
begin
  raise notice 'verbose: p_email=[%] v_id=%', p_email, v_id;
  delete from auth.users where email = p_email;
  get diagnostics v_deleted = row_count;
  raise notice 'verbose: deleted=%', v_deleted;
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_email, '{}'::jsonb);
  raise notice 'verbose: users now=%', (select count(*) from auth.users);
  return v_id;
end;
$$;

select diag(
  'STEP1 verbose alice: ' || tests.create_user_verbose('[email protected]')::text
  || ' => ' || (select coalesce(string_agg(id::text || ':' || email, ' | '), 'EMPTY')
                  from auth.users)
);

select diag(
  'STEP2 verbose bob: ' || tests.create_user_verbose('[email protected]')::text
  || ' => ' || (select coalesce(string_agg(id::text || ':' || email, ' | '), 'EMPTY')
                  from auth.users)
);

select diag(
  'STEP3 plain alice: ' || tests.create_user('[email protected]')::text
  || ' => ' || (select coalesce(string_agg(id::text || ':' || email, ' | '), 'EMPTY')
                  from auth.users)
);

select diag(
  'STEP4 plain bob: ' || tests.create_user('[email protected]')::text
  || ' => ' || (select coalesce(string_agg(id::text || ':' || email, ' | '), 'EMPTY')
                  from auth.users)
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
