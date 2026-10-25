-- Behavior matrix for the DB-counter rate limiter (ADR-0007): the table
-- is invisible to every app role (definer function only), the function
-- budgets per key window atomically, rejects bad input loudly (the route
-- is what fails closed), and resets a bucket once its window passes.

begin;

select plan(13);

-- ---------- static: table and function surface ----------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass),
  'SECURITY: RLS enabled on rate_limits'
);

select ok(
  not has_table_privilege('anon', 'public.rate_limits', 'select'),
  'anon has zero grants on rate_limits'
);

select ok(
  not has_table_privilege('authenticated', 'public.rate_limits', 'select'),
  'authenticated has zero grants on rate_limits'
);

select ok(
  not has_table_privilege('service_role', 'public.rate_limits', 'select'),
  'even service_role has zero grants — nothing legit reads the table'
);

select ok(
  has_function_privilege('anon', 'public.rate_limit_hit(text, integer, integer)', 'execute'),
  'anon may execute rate_limit_hit (the share route needs it)'
);

-- ---------- anon: the budget ----------
select tests.authenticate_as_anon();

select is(
  public.rate_limit_hit('test:rl:basic', 3, 60),
  true,
  'first call is inside the budget'
);

select is(
  public.rate_limit_hit('test:rl:basic', 3, 60),
  true,
  'second call is inside the budget'
);

select is(
  public.rate_limit_hit('test:rl:basic', 3, 60),
  true,
  'third call is inside the budget'
);

select is(
  public.rate_limit_hit('test:rl:basic', 3, 60),
  false,
  'fourth call exceeds the limit'
);

select throws_ok(
  $$ select public.rate_limit_hit('test:rl:bad-params', 0, 60) $$,
  '22023',
  'rate limit parameters must be positive',
  'a non-positive limit is rejected loudly'
);

select throws_ok(
  $$ select public.rate_limit_hit(repeat('x', 513), 3, 60) $$,
  '22023',
  'rate limit key must be 1-512 characters',
  'an oversized key is rejected loudly (keys carry header material)'
);

-- ---------- window expiry: superuser backdates, the budget resets ----------
select tests.clear_authentication();

update public.rate_limits
   set window_start = now() - interval '2 minutes'
 where key = 'test:rl:basic';

select tests.authenticate_as_anon();

select is(
  public.rate_limit_hit('test:rl:basic', 3, 60),
  true,
  'an expired window starts a fresh budget'
);

-- ---------- authenticated surface ----------
select tests.clear_authentication();

-- File-local user for the authenticated persona.
select tests.make_user('alice');
select tests.authenticate_as(current_setting('test.alice_email'));

select is(
  public.rate_limit_hit('test:rl:auth', 5, 60),
  true,
  'authenticated roles may use the limiter too'
);

select tests.clear_authentication();

select * from finish();
rollback;
