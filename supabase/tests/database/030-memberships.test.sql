-- RLS matrix + invariants for public.memberships. Personas: alice (owner),
-- carol (admin), dave/erin (members), bob (outsider). Fixtures are inserted as
-- the superuser runner (RLS bypassed) so behavior tests start from a known
-- state; every assertion runs under an explicit role + JWT claims.
-- The last-owner backstop is asserted as superuser on purpose: a persona
-- self-demotion also exercises WITH CHECK against the caller's own row, whose
-- snapshot semantics are not worth betting a gate on — the invariant itself
-- (and the non-self policy paths) are what we guarantee.

begin;

select plan(21);

-- ---------- setup (superuser) ----------
select tests.make_user('alice');
select tests.make_user('bob');
select tests.make_user('carol');
select tests.make_user('dave');
select tests.make_user('erin');

-- alice creates the org under her own identity (bootstrap trigger needs
-- auth.uid(); see 020 header).
select tests.authenticate_as(current_setting('test.alice_email'));

insert into public.organizations (name, slug)
values ('Team', 'team');

select tests.clear_authentication();

select set_config(
  'test.team_id',
  (select id from public.organizations where slug = 'team')::text,
  true
);

-- role fixtures: carol admin, dave + erin members; bob stays an outsider
insert into public.memberships (org_id, user_id, role)
values
  (current_setting('test.team_id')::uuid, tests.user_id(current_setting('test.carol_email')), 'admin'),
  (current_setting('test.team_id')::uuid, tests.user_id(current_setting('test.dave_email')), 'member'),
  (current_setting('test.team_id')::uuid, tests.user_id(current_setting('test.erin_email')), 'member');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.memberships'::regclass),
  'SECURITY: RLS enabled on memberships'
);

-- ---------- alice: owner ----------
select tests.authenticate_as(current_setting('test.alice_email'));

select is(
  (select count(*)::int from public.organizations),
  1,
  'alice sees her organization'
);

select is(
  (select count(*)::int from public.memberships),
  4,
  'owner sees all memberships of her organization'
);

select is(
  (select role::text from public.memberships
    where user_id = tests.user_id(current_setting('test.alice_email'))),
  'owner',
  'bootstrap membership carries the owner role'
);

-- ---------- bob: outsider ----------
select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select count(*)::int from public.memberships),
  0,
  'SECURITY: outsider sees no memberships'
);

select throws_ok(
  $$ insert into public.memberships (org_id, user_id)
     values (current_setting('test.team_id')::uuid, tests.user_id(current_setting('test.bob_email'))) $$,
  '42501',
  null,
  'SECURITY: no insert policy — joining an org without an invite is impossible'
);

-- ---------- carol: admin ----------
select tests.authenticate_as(current_setting('test.carol_email'));

update public.memberships
   set role = 'admin'
 where user_id = tests.user_id(current_setting('test.dave_email'));

select is(
  (select role::text from public.memberships
    where user_id = tests.user_id(current_setting('test.dave_email'))),
  'admin',
  'admin can promote a member to admin'
);

update public.memberships
   set role = 'member'
 where user_id = tests.user_id(current_setting('test.alice_email'));

select throws_ok(
  $$ update public.memberships set role = 'owner'
     where user_id = tests.user_id(current_setting('test.dave_email')) $$,
  '42501',
  null,
  'SECURITY: admin cannot grant the owner role'
);

delete from public.memberships
 where user_id = tests.user_id(current_setting('test.alice_email'));

select tests.clear_authentication();

select is(
  (select role::text from public.memberships
    where user_id = tests.user_id(current_setting('test.alice_email'))),
  'owner',
  'SECURITY: admin cannot demote an owner (row invisible to the UPDATE)'
);

select is(
  (select count(*)::int from public.memberships
    where org_id = current_setting('test.team_id')::uuid),
  4,
  'SECURITY: admin cannot remove an owner'
);

-- ---------- erin: member ----------
select tests.authenticate_as(current_setting('test.erin_email'));

update public.memberships set role = 'admin'
 where user_id = tests.user_id(current_setting('test.erin_email'));

delete from public.memberships
 where user_id = tests.user_id(current_setting('test.carol_email'));

select throws_ok(
  $$ update public.memberships
        set org_id = '00000000-0000-0000-0000-000000000000'
      where user_id = tests.user_id(current_setting('test.erin_email')) $$,
  '42501',
  null,
  'SECURITY: org_id is not updatable (column grant) — no cross-tenant row moves'
);

select tests.clear_authentication();

select is(
  (select role::text from public.memberships
    where user_id = tests.user_id(current_setting('test.erin_email'))),
  'member',
  'SECURITY: member cannot change any role (self-promotion filtered by USING)'
);

select is(
  (select count(*)::int from public.memberships
    where user_id = tests.user_id(current_setting('test.carol_email'))),
  1,
  'SECURITY: member cannot remove other members'
);

-- ---------- superuser: the last-owner invariant (the gate) ----------
select throws_ok(
  $$ update public.memberships set role = 'member'
     where org_id = current_setting('test.team_id')::uuid
       and user_id = tests.user_id(current_setting('test.alice_email')) $$,
  'P0001',
  'an organization must keep at least one owner',
  'GATE: the last owner cannot demote themselves'
);

select throws_ok(
  $$ delete from public.memberships
      where org_id = current_setting('test.team_id')::uuid
        and user_id = tests.user_id(current_setting('test.alice_email')) $$,
  'P0001',
  'an organization must keep at least one owner',
  'GATE: the last owner cannot be removed'
);

-- ---------- profile visibility (member lists) ----------
select tests.authenticate_as(current_setting('test.alice_email'));

select is(
  (select count(*)::int from public.profiles
    where id <> tests.user_id(current_setting('test.alice_email'))),
  3,
  'owner sees the profiles of co-members (carol, dave, erin)'
);

select tests.authenticate_as(current_setting('test.bob_email'));

select is(
  (select count(*)::int from public.profiles
    where id <> tests.user_id(current_setting('test.bob_email'))),
  0,
  'SECURITY: outsider sees no profiles'
);

-- ---------- second owner unblocks the demotion path ----------
-- (superuser inserts bob as the second owner)
insert into public.memberships (org_id, user_id, role)
values (current_setting('test.team_id')::uuid, tests.user_id(current_setting('test.bob_email')), 'owner');

select tests.authenticate_as(current_setting('test.alice_email'));

update public.memberships
   set role = 'member'
 where user_id = tests.user_id(current_setting('test.bob_email'));

select is(
  (select role::text from public.memberships
    where user_id = tests.user_id(current_setting('test.bob_email'))),
  'member',
  'owner can demote another owner while a second one remains'
);

-- ---------- dave (now admin): remove a member, then leave ----------
select tests.authenticate_as(current_setting('test.dave_email'));

delete from public.memberships
 where user_id = tests.user_id(current_setting('test.erin_email'));

delete from public.memberships
 where user_id = tests.user_id(current_setting('test.dave_email'));

select tests.clear_authentication();

select is(
  (select count(*)::int from public.memberships
    where user_id = tests.user_id(current_setting('test.erin_email'))),
  0,
  'admin removed a member'
);

select is(
  (select count(*)::int from public.memberships
    where user_id = tests.user_id(current_setting('test.dave_email'))),
  0,
  'any member may leave the organization'
);

select is(
  (select count(*)::int from public.memberships
    where org_id = current_setting('test.team_id')::uuid),
  3,
  'remaining membership: alice (owner), carol (admin), bob (member)'
);

select * from finish();

rollback;
