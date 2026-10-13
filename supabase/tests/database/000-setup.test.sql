-- Test helpers — runs FIRST (000- prefix).
-- pg_prove treats every *.test.sql as a TAP file, so this file must emit a
-- plan. It must NOT open a transaction: helper functions have to persist for
-- the test files that follow (supabase test db does not wrap files in one).
-- NEVER migrate this file: it lives in supabase/tests, not supabase/migrations.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Create a row in auth.users (the profiles trigger fires automatically).
-- Idempotent: deletes any existing row first (cascade removes the profile),
-- so a rerun or a dirty database can never trip the unique email index.
create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  delete from auth.users where email = p_email;
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_email, '{}'::jsonb);
  return v_id;
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

select plan(2);

select ok(
  to_regprocedure('tests.create_user(text)') is not null,
  'helpers: create_user loaded'
);

select ok(
  to_regprocedure('tests.clear_authentication()') is not null,
  'helpers: clear_authentication loaded'
);

select * from finish();
