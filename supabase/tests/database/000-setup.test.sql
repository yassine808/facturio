-- Test helpers — runs FIRST (000- prefix).
-- pg_prove treats every *.test.sql as a TAP file, so this file must emit a
-- plan. It must NOT open a transaction: helper functions have to persist for
-- the test files that follow (supabase test db does not wrap files in one).
-- NEVER migrate this file: it lives in supabase/tests, not supabase/migrations.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Create a row in auth.users (the profiles trigger fires automatically).
-- NOTE: deliberately does NOT delete a pre-existing row — observed on the CI
-- local stack, `delete from auth.users where email = <x>` removed rows whose
-- stored email was a DIFFERENT value (details in docs/PROGRESS.md). Deleting
-- is therefore banned here; callers use per-run unique emails instead
-- (see tests.make_user), which also makes reruns deterministic.
create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_email, '{}'::jsonb);
  return v_id;
end;
$$;

-- Create a user with a run-unique email and remember that email in a
-- transaction-local GUC (test.<prefix>_email) so the rest of the test file
-- can look the user up with current_setting('test.<prefix>_email') without
-- hardcoding an address that might collide with stale rows.
create or replace function tests.make_user(p_prefix text)
returns uuid
language plpgsql
as $$
declare
  v_email text :=
    p_prefix || '.' || substr(gen_random_uuid()::text, 1, 8) || '@test.example';
begin
  perform set_config('test.' || p_prefix || '_email', v_email, true);
  return tests.create_user(v_email);
end;
$$;

-- Look up a user id while acting as `authenticated` (definer: superuser body).
create or replace function tests.user_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select id from auth.users where email = p_email $$;

-- Act as a signed-in user for the rest of the current transaction.
-- Called by the superuser runner; SET LOCAL ROLE sticks for the transaction.
create or replace function tests.authenticate_as(p_email text)
returns void
language plpgsql
as $$
declare
  v_id uuid := tests.user_id(p_email);
begin
  if v_id is null then
    raise exception 'test user % does not exist', p_email;
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text,
    true -- transaction-local
  );
  execute 'set local role authenticated';
end;
$$;

-- Act as an anonymous visitor.
create or replace function tests.authenticate_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

-- Back to superuser for the next persona block.
-- RESET ROLE / SET ROLE NONE may be executed by any user (PostgreSQL docs),
-- so this is safe even though it runs while the role is `authenticated`.
create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end;
$$;

-- Persona roles must be able to CALL these helpers (schema USAGE + execute).
-- Without this, any assertion calling tests.* as anon/authenticated dies with
-- "permission denied for schema tests". Future functions: re-run the execute
-- grant (usage grant persists on the schema).
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select plan(2);

select ok(
  to_regprocedure('tests.make_user(text)') is not null,
  'helpers: make_user loaded'
);

select ok(
  to_regprocedure('tests.clear_authentication()') is not null,
  'helpers: clear_authentication loaded'
);

select * from finish();
