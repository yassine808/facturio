-- Test helpers — persistent across test files (no transaction wrapper here on
-- purpose: later files reuse these functions). NEVER migrate this file: it
-- lives in supabase/tests, not supabase/migrations.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Create a row in auth.users (the profiles trigger fires automatically).
create or replace function tests.create_user(p_email text)
returns uuid
language sql
as $$
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), p_email, '{}'::jsonb)
  returning id;
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
create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end;
$$;
