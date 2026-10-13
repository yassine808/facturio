-- RLS matrix + acceptance behavior for public.invitations.
-- GATE coverage: valid invite works, single-use, expired rejected, and a
-- token issued to someone else cannot be redeemed by a different account.
-- Token hashing: the app stores sha256(token) as token_hash; tests therefore
-- pass deterministic literals ('invite-bob') through extensions.digest the
-- same way the app does in TypeScript.

begin;

select plan(17);

-- ---------- setup (superuser) ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('carol');
select tests.make_user('dave');
select tests.make_user('erin');

select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.organizations (name, slug)
values ('Acme', 'acme');

select tests.clear_authentication();

select set_config(
  'test.acme_id',
  (select id from public.organizations where slug = 'acme')::text,
  true
);

insert into public.memberships (org_id, user_id, role)
values
  (current_setting('test.acme_id')::uuid, tests.user_id(current_setting('test.carol_email')), 'admin'),
  (current_setting('test.acme_id')::uuid, tests.user_id(current_setting('test.dave_email')), 'member');

insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
values
  (current_setting('test.acme_id')::uuid, current_setting('test.bob_email'), 'member',
   encode(extensions.digest('invite-bob', 'sha256'), 'hex'),
   tests.user_id(current_setting('test.alice_email')), now() + interval '7 days'),
  (current_setting('test.acme_id')::uuid, current_setting('test.erin_email'), 'member',
   encode(extensions.digest('invite-expired', 'sha256'), 'hex'),
   tests.user_id(current_setting('test.alice_email')), now() - interval '1 day'),
  (current_setting('test.acme_id')::uuid, current_setting('test.carol_email'), 'member',
   encode(extensions.digest('invite-carol', 'sha256'), 'hex'),
   tests.user_id(current_setting('test.alice_email')), now() + interval '7 days');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.invitations'::regclass),
  'SECURITY: RLS enabled on invitations'
);

-- ---------- anon cannot even call the function ----------
select tests.authenticate_as_anon();

select throws_ok(
  $$ select public.accept_invitation('invite-bob') $$,
  '42501',
  null,
  'SECURITY: accept_invitation is not executable by anon'
);

-- ---------- bob accepts his invite (the gate) ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select status from public.accept_invitation('invite-bob')),
  'accepted',
  'GATE: invited user accepts a valid invitation'
);

select tests.clear_authentication();

select is(
  (select count(*)::int from public.memberships
    where org_id = current_setting('test.acme_id')::uuid
      and user_id = tests.user_id(current_setting('test.bob_email'))
      and role = 'member'),
  1,
  'acceptance created exactly one membership with the invited role'
);

select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select status from public.accept_invitation('invite-bob')),
  'invalid',
  'GATE: invitations are single-use — a second accept fails'
);

-- ---------- expiry and email binding ----------
select tests.authenticate_as(current_setting('test.erin_email'));

select is(
  (select status from public.accept_invitation('invite-expired')),
  'invalid',
  'GATE: expired invitations are rejected'
);

select tests.clear_authentication();

select is(
  (select count(*)::int from public.memberships
    where user_id = tests.user_id(current_setting('test.erin_email'))),
  0,
  'expired invitation created no membership'
);

select tests.authenticate_as(current_setting('test.dave_email'));

select is(
  (select status from public.accept_invitation('invite-carol')),
  'wrong_email',
  'GATE: a token issued to another email cannot be redeemed'
);

select tests.clear_authentication();

select is(
  (select count(*)::int from public.memberships
    where org_id = current_setting('test.acme_id')::uuid
      and user_id = tests.user_id(current_setting('test.dave_email'))),
  1,
  'failed hijack left the membership table untouched'
);

select tests.authenticate_as(current_setting('test.carol_email'));

select is(
  (select status from public.accept_invitation('invite-carol')),
  'accepted',
  'matching account accepts its pending invitation'
);

-- ---------- RLS on invitation rows ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is_empty(
  $$ select id from public.invitations $$,
  'SECURITY: plain members cannot list invitations'
);

select tests.authenticate_as(current_setting('test.carol_email'));

select is(
  (select count(*)::int from public.invitations),
  3,
  'admins see every invitation of their organization'
);

select throws_ok(
  $$ insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
     values (current_setting('test.acme_id')::uuid, 'late@x.test', 'member',
             '00000000000000000000000000000000000000000000000000000000000000aa',
             tests.user_id(current_setting('test.carol_email')), now() - interval '1 day') $$,
  '42501',
  null,
  'SECURITY: invites must not be created already expired'
);

select tests.authenticate_as(current_setting('test.bob_email'));

select throws_ok(
  $$ insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
     values (current_setting('test.acme_id')::uuid, 'sneaky@x.test', 'member',
             '00000000000000000000000000000000000000000000000000000000000000bb',
             tests.user_id(current_setting('test.bob_email')), now() + interval '7 days') $$,
  '42501',
  null,
  'SECURITY: members cannot create invitations'
);

delete from public.invitations
 where org_id = current_setting('test.acme_id')::uuid;

select tests.clear_authentication();

select is(
  (select count(*)::int from public.invitations),
  3,
  'SECURITY: member revocation attempt removed nothing'
);

select tests.authenticate_as(current_setting('test.carol_email'));

delete from public.invitations
 where token_hash = encode(extensions.digest('invite-expired', 'sha256'), 'hex');

select tests.clear_authentication();

select is(
  (select count(*)::int from public.invitations),
  2,
  'admin revoked (deleted) an invitation'
);

select is(
  (select count(*)::int from public.invitations where accepted_by is not null),
  2,
  'both successful acceptances are marked on their invitation rows'
);

select * from finish();

rollback;
