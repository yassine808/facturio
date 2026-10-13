# ADR-0004: RLS helper functions — schema, security, grants

- **Status:** accepted (2026-10-13, Phase 2)
- **Deciders:** yassine808 + agent

## Context

Policies like `memberships_delete` must ask "is the caller an owner of this
org?" on every row. Doing that with a plain subquery against `memberships`
recurses infinitely (the policy on `memberships` would query `memberships`,
which re-evaluates the policy). The helpers also need to answer from _ground
truth_: they must see membership rows exactly as stored, unfiltered by the
caller's own RLS view.

## Decision

Helper functions live in the **`public` schema** as `SECURITY DEFINER` with
`set search_path = ''` and fully qualified references:

- `is_org_member(org_id) → boolean`
- `org_role(org_id) → org_role` (null when not a member)
- `has_org_role(org_id, org_role[]) → boolean`
- `share_org_with(other_user_id) → boolean` (shared-org test for profile reads)

Grant posture (each function, explicitly):

- `REVOKE … FROM anon, public` — Postgres grants `EXECUTE` to `PUBLIC` by
  default; anon gets nothing.
- `GRANT … TO authenticated` — the only role that reaches RLS policies.

Being `SECURITY DEFINER` (owned by the migration author, i.e. the table owner)
they run with RLS bypassed internally, which (a) breaks policy recursion and
(b) makes them a trustworthy oracle. They only ever read membership facts and
take no user-supplied text — no injection surface.

## Alternatives considered

- **`private` schema** (as the build brief suggests): hides the functions from
  the PostgREST surface entirely, but policies referencing
  `private.has_org_role(…)` then require the querying role to hold `USAGE` on
  `private` plus `EXECUTE` on the function — the same exposure, with extra
  grants to manage and a second schema to keep in migrations, backups and
  `search_path` discussions. Not worth it for four read-only predicates whose
  existence reveals nothing (an attacker who can call them already has a
  session, and membership is visible to co-members anyway).
- **Plain SQL functions in policies:** infinite recursion on `memberships`.
- **`security invoker` helpers reading an unlogged side table:** two sources of
  truth for membership. Rejected.

## Consequences

- The functions appear on the PostgREST RPC surface for `authenticated` users.
  Documented here as accepted: each is a narrow, read-only predicate.
- Any future helper follows this recipe verbatim: `security definer`, empty
  `search_path`, qualified names, revoked-from-PUBLIC, granted to
  `authenticated`, and a pgTAP case proving anon cannot execute it.
