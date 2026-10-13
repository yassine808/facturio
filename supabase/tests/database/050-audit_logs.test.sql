-- RLS matrix for public.audit_logs. The trail is append-only through the API:
-- members of an org can read it, anyone can add rows strictly as themselves,
-- and there is no UPDATE/DELETE path (no policy, no grant).

begin;

select plan(10);

-- ---------- setup (superuser) ----------
select tests.make_user('alice');
select tests.make_user('bob');

select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.organizations (name, slug)
values ('Acme', 'acme');

select tests.clear_authentication();

select set_config(
  'test.acme_id',
  (select id from public.organizations where slug = 'acme')::text,
  true
);

-- one hand-written row on top of the org.created row the trigger wrote
insert into public.audit_logs (org_id, actor_id, action, target_type)
values (current_setting('test.acme_id')::uuid,
        tests.user_id(current_setting('test.alice_email')),
        'member.invited', 'invitation');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_logs'::regclass),
  'SECURITY: RLS enabled on audit_logs'
);

select is(
  (select count(*)::int from public.audit_logs),
  2,
  'setup: org.created trigger row + one fixture row'
);

-- ---------- anon ----------
select tests.authenticate_as_anon();

select is_empty(
  $$ select id from public.audit_logs $$,
  'SECURITY: anon sees no audit rows'
);

-- ---------- members ----------
select tests.authenticate_as(current_setting('test.alice_email'));

select is(
  (select count(*)::int from public.audit_logs),
  2,
  'owner reads her organization audit trail'
);

insert into public.audit_logs (org_id, actor_id, action, target_type)
values (current_setting('test.acme_id')::uuid,
        tests.user_id(current_setting('test.alice_email')),
        'test.event', 'organization');

select is(
  (select count(*)::int from public.audit_logs),
  3,
  'members may append audit rows as themselves'
);

select throws_ok(
  $$ insert into public.audit_logs (org_id, actor_id, action)
     values (current_setting('test.acme_id')::uuid,
             tests.user_id(current_setting('test.bob_email')),
             'forged.event') $$,
  '42501',
  null,
  'SECURITY: actor_id must be the caller — no forged attribution'
);

select throws_ok(
  $$ update public.audit_logs set action = 'tampered'
     where action = 'org.created' $$,
  '42501',
  null,
  'SECURITY: the trail is immutable (no update grant)'
);

select throws_ok(
  $$ delete from public.audit_logs where action = 'org.created' $$,
  '42501',
  null,
  'SECURITY: the trail is immutable (no delete grant)'
);

-- ---------- outsider ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select count(*)::int from public.audit_logs),
  0,
  'SECURITY: outsiders see no audit rows'
);

select tests.clear_authentication();

select is(
  (select count(*)::int from public.audit_logs),
  3,
  'only the single self-attributed insert was added'
);

select * from finish();

rollback;
