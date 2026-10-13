# ADR-0002: Multi-tenancy via shared schema + RLS

- **Status:** accepted (2026-10-13, Phase 2)
- **Deciders:** yassine808 + agent, per build brief ("Supabase RLS multi-tenancy")

## Context

Facturio must isolate every tenant's data (clients, invoices, files) with no
option to leak rows across organizations, and every later phase (clients,
invoices, billing) inherits whatever model we pick here. The database is
Supabase/Postgres; the app talks to it through PostgREST with the user's own
session, so row-level enforcement is available natively.

## Decision

**Shared database, shared schema, `org_id` on every tenant-scoped table, and
Postgres Row-Level Security as the isolation boundary.**

- Every tenant table (`memberships`, `invitations`, `audit_logs`, and Phase 3's
  clients/invoices) carries `org_id uuid references organizations(id)`.
- RLS is enabled on every table; policies grant operations per role:
  `owner > admin > member`, resolved through the `public.org_role(org_id)` /
  `public.has_org_role(org_id, roles[])` helpers (see ADR-0004).
- Defense in depth, in this order: column-level grants (coarse), RLS policies
  (row), DB triggers as invariants (last-owner backstop), then server-action
  role re-checks (product rules), then UI gating (ergonomics only).
- Joining an organization happens **only** through DB-mediated paths: the
  bootstrap trigger on `organizations` (creator becomes owner) and the
  `accept_invitation()` definer function. `memberships` has no insert policy
  and no insert grant for `authenticated` — direct self-join is impossible by
  construction, not by policy someone could forget.

## Alternatives considered

- **Row-level security per table without shared helpers:** each policy re-implements
  membership checks inline; invites would need a bypass mechanism that is easy to
  get wrong. Rejected.
- **Schema-per-tenant:** strong isolation, but migration fan-out, pooling cost, and
  PostgREST routing make it disproportionate for an MVP-sized SaaS.
- **Application-layer filtering only** (`where org_id = …` in every query): one
  forgotten filter leaks data; untestable at the DB layer. Rejected outright.

## Consequences

- pgTAP tests (020–050) assert the full RLS matrix including cross-tenant
  attack cases, so later phases extend the same pattern instead of inventing
  new one.
- The last-owner backstop trigger means account/org deletion paths must account
  for cascade contexts (they do — the trigger skips rows whose org or profile
  no longer exists).
- Scaling past ~one region/large enterprise tenants later can add per-tenant
  partitioning without changing the application-facing model.
