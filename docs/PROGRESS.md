# PROGRESS.md

Status log for the multi-tenant invoice SaaS. Updated at the end of every session.

## Status

**Current phase:** Phase 5 — delivery (PDF invoices, email via Resend, share links; the
Resend account is the user blocker for anything live)

Phase 4 shipped: merged `--no-ff` as `ad56a32`, tagged `v0.4`, pushed. PR #9 closed as
merged. CI green on the merge (all 9 checks, all 11 pgTAP files — run 38491419691 on the
branch). Live Stripe verification still waits on the user's Stripe test account; schema,
webhook handler, and tests need no account.

Phase 3 shipped: merged `--no-ff` as `3f4e304`, tagged `v0.3`, pushed. PR #8 closed as
merged. CI green on the merge (all 9 checks, all 10 pgTAP files).

## Done

- [Phase 0] Environment check: Windows 11, PowerShell 5.1, Node v24.15.0, pnpm 11.1.3, Git 2.53.0.
  Missing: Docker, Supabase CLI, Stripe CLI (install commands prepared, nothing installed).
- [Phase 0] Docs research: Next.js 16 stable (middleware renamed → `proxy.ts`), @supabase/ssr 0.12.5
  (`getClaims()` / `getUser()` recommended over `getSession()` on server), Supabase pgTAP via
  `supabase test db`, Stripe API 2026-05-27.dahlia (raw body for webhook signature, `event.id`
  uniqueness for idempotency, no `created`-based ordering).
- [Phase 0] Git repo initialized at `D:\Projects\project1`, identity set, remote `origin` added.
- [Phase 0] Bootstrap files: `AGENTS.md`, `.gitignore`, `docs/PROGRESS.md`, `README.md` stub.
- [Phase 0] Question batch answered (8/8), `docs/PLAN.md` written, pushed to `origin/main`.
- [Phase 0] User approved the plan → Phase 1 started.
- [Phase 1] Next.js 16 + TypeScript app scaffolded (App Router, strict TS, Tailwind v4,
  `proxy.ts` instead of `middleware.ts`, `cacheComponents` OFF per ADR-0001).
- [Phase 1] Auth flows: signup (email confirmation), login, logout, forgot-password,
  reset-password, OAuth disabled placeholders. Server actions via React 19 `useActionState`.
  Session refresh in `proxy.ts`; server pages use `getUser()`.
- [Phase 1] Protected shell: `/app` layout with user email, `/app` home, `/api/health`
  (status/env/supabase flags, never leaks secrets — asserted in e2e).
- [Phase 1] Dark theme default (`<html class="dark">`) with `.dark`-driven CSS vars.
- [Phase 1] DB: `profiles` table migration + trigger + RLS (4 policies) + pgTAP test suite
  (`000-setup` helpers, `010-profiles` RLS matrix, 11 assertions).
- [Phase 1] CI: 9 checks — lint, typecheck, vitest, check:env, pnpm audit, gitleaks,
  supabase migrate + pgTAP, build, e2e (Playwright + axe accessibility).
- [Phase 1] Local verification: lint 0, typecheck 0, vitest 4/4, check:env OK, build OK,
  all 9 CI checks green (run 38390662611).
- [Phase 2] Tenancy core (ADR-0002): `org_role` enum, `organizations`, `memberships`,
  `invitations`, `audit_logs` — 4 migrations, shared schema + `org_id` on tenant rows + RLS on
  every table. `memberships` has no INSERT grant for authenticated (self-join happens only via
  signup trigger + `accept_invitation` RPC).
- [Phase 2] SECURITY DEFINER helpers (ADR-0004): `is_org_member`, `org_role`, `has_org_role`,
  `share_org_with` — empty `search_path`, revoked from PUBLIC/anon, granted to authenticated.
  Last-owner protection: BEFORE UPDATE/DELETE trigger + owner-only role changes in RLS.
- [Phase 2] Invitations: 32 random bytes shown once as a base64url link, sha256 stored;
  7-day expiry; strict lowercase email match; invited role limited to member/admin; pending-only
  partial unique index; `accept_invitation` returns `accepted | invalid | wrong_email`.
- [Phase 2] Audit base: append-only `audit_logs` (INSERT-only grant, no UPDATE/DELETE policy),
  written best-effort from every mutating org action.
- [Phase 2] pgTAP: 4 new test files (020 organizations, 030 memberships, 040 invitations,
  050 audit + helper revocation), 59 new assertions; first CI run found 3 real bugs (see lessons).
- [Phase 2] App layer: Zod-parsed query helpers (no generated Supabase types), 6 server actions
  that re-check roles via `has_org_role` before touching data, `ActionForm` client primitive,
  onboarding at `/app` (redirect to first org when orgs exist), `/app/new`, `/app/[orgSlug]`,
  members settings, neutral `/invite/[token]` landing, org switcher in the app shell.
- [Phase 2] Unit tests: slug generation vs the DB CHECK regex, schema rules (email normalize
  before validate, owner never invitable). Local gate: lint 0, tsc 0, vitest 19/19, check:env
  OK, build OK; CI all 9 green (run 38455143709).
- [Phase 3] Clients: archive-not-delete (no DELETE policy), member-writable, `org_id` not in the
  update grant. 5 migrations total in the phase; pgTAP files 060 (clients, 12), 070 (invoices
  - numbering, 26), 080 (items + money pipeline, 21), 090 (payments, 17) = 76 assertions.
- [Phase 3] Invoices + numbering (ADR-0006): gap-free per-(org, year) sequence allocated exactly
  once at draft→sent from a locked counter row; drafts unnumbered; rollback returns the number
  (savepoint test); transitions enforced in one rule function; overdue derived, never stored.
  Sent/paid/void invoices are frozen: status is the only editable column (migration 0009).
- [Phase 3] Money pipeline (ADR-0003): `line = round(qty × price)`, subtotal = Σ lines,
  `tax = round(subtotal × bps / 10000)`, total = subtotal + tax — all trigger-computed; money
  columns and `line_total` carry no update grant; tax-rate edits recompute in-row.
- [Phase 3] Payments: insert/delete only while the invoice is sent; coverage in full flips
  sent→paid automatically; history freezes with the invoice; no UPDATE grant (corrections are
  delete + re-record).
- [Phase 3] App: clients directory (search, pagination, archive toggle), invoice draft editor
  with a dynamic line editor, send / void / mark-paid transitions, payment record/remove,
  invoice list with status tabs and derived overdue badges, dashboard with per-currency
  outstanding/overdue/paid-this-month metrics and recent invoices.
- [Phase 3] ADR-0003 (money minor units + one rounding rule), ADR-0006 (gap-free numbering).
  Unit tests: money parse/format round-trip, tax percent→bps integer conversion, invoice draft
  schema rules (17 new tests; 43/43 green locally). Local gate: lint 0, tsc 0, build OK.
- [Phase 3] First end-to-end migration + pgTAP application happened in CI only (no Docker
  locally) and caught three real bugs: a composite-FK target added after the `CREATE TABLE`
  that validates against it (42830), the missing counters revoke, and pgTAP API mismatches —
  fixed in `176caa3`, `7ead7b0`, `ee13add`. Final run 38471820173: all 9 checks green, all 10
  pgTAP files ok.
- [Phase 4] ADR-0005 (Stripe = source of truth via webhooks only): `subscriptions` is the read
  model — born `free` by a definer trigger on org insert, select-only for the app (no write
  grants), written exclusively by the webhook handler through the new service-role client
  (`src/lib/supabase/service-role.ts`, the only RLS-bypassing client in the repo).
  `stripe_events` is the idempotency ledger (evt id as PK, zero policies, no app grants).
  `platform_admins` added per brief §7.2, ops-only until the Phase 6 admin surface.
- [Phase 4] Plan limits in the DB: `clients_plan_limit` BEFORE INSERT OR UPDATE trigger caps
  free orgs at 3 active clients — archiving is never blocked, restore counts toward the cap,
  pro orgs exempt, applies to every role (superuser included). Downgrades never clean up
  retroactively; new writes are capped.
- [Phase 4] Webhook pipeline (`/api/webhooks/stripe`): raw body + signature verification
  (400 before any DB write), pure event processor behind a four-method writer interface,
  `event.id` recorded LAST so duplicate deliveries collapse on the ledger PK, unknown types
  recorded + acked, 500 on processing failure so Stripe retries (dedup makes retries safe).
  Events consumed: checkout.session.completed (org mapping via session metadata),
  customer.subscription.updated (status/plan mirror), customer.subscription.deleted (→ free).
- [Phase 4] Checkout + Customer Portal server actions (owner/admin only; honest errors when
  unconfigured), `/app/[orgSlug]/settings/billing` page (plan card with status + renewal,
  usage vs limit, upgrade/manage), dashboard Billing quick link,
  `scripts/create-stripe-price.mjs` (creates the Pro price once via lookup key `pro_monthly`
  — no price id ever configured by hand).
- [Phase 4] Tests: pgTAP `100-subscriptions` (24 assertions — bootstrap row, member/outsider/
  anon read matrix, app write denial, limit insert + restore paths, pro exemption with limits
  returning on downgrade, paid-plan CHECK, ledger PK rejection, invisible tables, cascade);
  vitest +17 (signature verification incl. tampered body, attach→record call order,
  duplicate, out-of-order, malformed checkout, planForStatus table). Local gate: lint 0,
  tsc 0, vitest 60/60, check:env OK, build OK.
- [Phase 4] `clients` actions forward P0001 trigger messages verbatim (the plan-limit message
  now reaches the user instead of "Could not save the client").

## Key lessons from Phase 1 CI debugging

- **Never `DELETE FROM auth.users` in test helpers.** On the CI local stack, deleting by email
  demonstrably removed a row whose stored email was a _different_ value (root cause unresolved,
  the mechanism was sidestepped). Banned in `000-setup` comments; personas now use
  `tests.make_user(prefix)` → run-unique `prefix.<8hex>@test.example` emails stored in
  transaction-local GUCs (`test.alice_email`), referenced via `current_setting()`. No hardcoded
  emails anywhere in tests.
- **Grants matter:** `grant usage on schema tests` + `grant execute on all functions in schema
tests to anon, authenticated` in `000-setup`, or assertions calling `tests.*` under a persona
  die with "permission denied for schema tests".
- **SQL description strings must be single-quoted** (double quotes = identifiers). Escape inner
  apostrophes as `''`.
- **Data-modifying CTEs must be at the top level of a statement** — `is((with r as (update …)))`
  is invalid SQL. Pattern: run the DML as its own top-level statement (RLS filters denied
  writes silently to 0 rows), then assert the resulting state with a plain `SELECT`.
- **Row-count assertions:** `WITH … RETURNING` + `count(*)::int` via `is()` — never
  `results_eq(…, values(0))`.
- **pg_prove specifics:** `ON_ERROR_STOP=1`, files run sequential/alphabetical, not wrapped in
  one transaction; `000-setup` emits `plan(2)` but NO transaction (helper functions must
  persist for later files).
- **Tailwind v4 cascade-layers trap:** utilities live in layers; the plain `body {}` rule in
  `globals.css` is unlayered and therefore _beats_ every layered utility on the body element.
  Background/foreground must come from CSS vars driven by `.dark` on `<html>` — an
  `@media (prefers-color-scheme: dark)` var block desyncs the painted background from the
  `dark:` text variants (light bg + dark text = axe color-contrast failures). Caught by the
  axe e2e check, not by eyeballs.
- **e2e accessibility assertion maps per-node** (`id @ target`) so a failure names the exact
  element instead of one opaque violation id.
- **CI-log emails are masked** (`[email protected]`) — never distinguish email values from
  logs; use counts, UUIDs, and `raise notice` output instead.
- Verify files from disk (`Select-String` / `git show`) after every write — an earlier pair of
  edits reported success but never persisted.

## Key lessons from Phase 2

- **Column grants are checked BEFORE RLS.** Giving `anon` no SELECT grant made denied reads
  raise `42501` (permission denied) instead of the empty result the policy intends. Tenant
  tables keep read grants for anon; policies are `to authenticated` (+ security-barrier
  helpers), so anon gets zero rows — same pattern Phase 1 used for `profiles`.
- **`RETURNS TABLE` OUT parameters shadow real columns.** `ON CONFLICT (org_id, email)` inside
  `accept_invitation` resolved to the function's own `org_id` OUT param → ambiguity error.
  Fix: name the constraint instead (`ON CONFLICT ON CONSTRAINT memberships_org_id_user_id_key`).
- **Every pgTAP persona block must end with `clear_authentication()`** before the next
  superuser statement — a persona left authenticated makes subsequent setup/DDL run under
  that role and fail confusingly.
- **`set_config(text, value, true)` needs a `::text` cast** when the value is a uuid.
- **React 19 lint bans `setState` in effect bodies** (`react-hooks/set-state-in-effect`):
  the invite link URL is now derived during render — the component only renders client-side
  after an action returns, so `window` is always available and no effect is needed.
- **commitlint rejects sentence-case subjects** — a subject starting with a capital (e.g.
  "ActionForm…") fails `subject-case`; start subjects lowercase.

## Key lessons from Phase 3

- **RLS silently empties subqueries in outsider blocks.** An outsider's `select id from
invoices where …` inside an INSERT binds `null` (their policies hide the rows), so the
  intended `42501` becomes a `23502` not-null violation. Outsider tests now reference target
  ids through `set_config` GUCs captured while the row was visible — never through a
  subquery RLS will empty.
- **Verify pgTAP assertion counts by regex after every edit** (`select (ok|is|is_empty|isnt|
throws_ok|like)\(`), not by eye — plans drifted twice during file growth.
- **A trigger's `raise exception` message is user-facing.** Tests assert it byte-for-byte
  (em-dashes included) and the app forwards P0001 messages verbatim instead of re-wording
  the same rule in five places.
- **Insert `WITH CHECK` violations raise `42501`** (they do not degrade to silent 0-row
  inserts), and column grants are checked before RLS — both shaped the grant-denial tests.
- **Trigger assignments bypass caller grant checks** — that is how definer-side columns
  (`new.number`, `line_total`, `status` flips) get written on tables the app can only
  partially update.
- **Composite FKs are the cross-tenant child-row defense** (`(invoice_id, org_id)` pairs):
  happy RLS + foreign row = `23503`, proven in both 080 and 090.
- **Payments carry no currency column** — the amount is in the invoice's currency; dashboard
  sums embed the invoice to group per currency (mixed-currency sums would be fake numbers).
- **Name collisions with the Supabase factory:** a feature action called `createClient` forced
  aliasing the server factory (`createClient as createSupabaseClient`) at import sites.
- **An FK target must exist before the referencing `CREATE TABLE`.** Postgres validates
  composite FK targets when the referencing table is created, so `unique (id, org_id)` on
  `clients` has to precede `create table invoices` (otherwise SQLSTATE 42830). Migrations
  written without a local database can carry statement-order bugs for a long time — only the
  first clean end-to-end application surfaces them.
- **Supabase default privileges grant every new table to anon/authenticated/service_role.**
  Every table needs an explicit `revoke all … from anon, authenticated`, and zero-policy RLS
  alone is not a denial: a granted read returns an empty result, never an error. That is how
  `invoice_counters` stayed silently readable despite a comment promising zero grants.
- **pgTAP's regex assertion is `matches(anyelement, text, text)` — `like()` no longer
  exists** in current pgTAP, and `is(anyelement, anyelement)` cannot unify a bigint column
  with an untyped integer literal: every money assertion needs an explicit `::bigint`.
- **Column grants are checked before BEFORE triggers.** Inserting `status` where `status`
  is not in the insert grant raises `42501` before the born-draft trigger can raise `P0001`;
  the test asserts both layers separately (member → 42501 grant denial, superuser → P0001
  trigger message).

## Key lessons from Phase 4

- **Trigger enforcement applies to fixture authors too: `clients_plan_limit` fires for every
  role, superuser included.** Any future test file or seed script needing more than 3 active
  clients in one org must first set `plan = 'pro'` (with a `stripe_subscription_id`, per the
  CHECK) as superuser — noted in the migration comment next to the trigger.
- **Stripe's basil API version moved `current_period_end` between `Subscription` and
  `SubscriptionItem`** — the code reads both shapes (outer field, then first item) instead of
  betting on which one the installed SDK exposes.
- **Out-of-order webhook deliveries are handled by targeting the update, not by a lookup:**
  `customer.subscription.updated` updates `where stripe_subscription_id = …`; zero rows
  matched means the mapping event has not landed yet → ack, record, skip. No read-modify
  race, no ordering assumption.
- **Keep the webhook processor pure behind a writer interface** — every interesting case
  (duplicate, out-of-order, bad signature, malformed metadata) is a vitest with a fake writer
  and a hand-HMAC-signed payload; no Stripe account or network needed in CI.
- **`redirect()` inside a server action throws NEXT_REDIRECT** — it must live outside the
  try/catch around the Stripe API calls, or the catch silently swallows the redirect.

## Next

- Phase 5: PDF invoices (`@react-pdf/renderer`), email via Resend (Mailpit locally,
  documented disabled mode until the account exists), share links (tokenized read-only
  public invoice view with hardened policies). ADR first if a boundary decision appears.
- Live Stripe verification once the user creates the Stripe test account:
  `scripts/create-stripe-price.mjs`, then `stripe listen --forward-to localhost:3000/api/
webhooks/stripe`, then one real checkout. Code + tests already complete without it.
- Doc gap to close before "MVP done" (§11): `docs/DATA_MODEL.md` (PLAN §5 deliverable) —
  migrations remain the source of truth until it is consolidated with an ERD.
- Resend account before Phase 5 email goes live.
- Docker Desktop still not installed locally → DB/e2e verified in CI only.

## Blockers

- Stripe test account (blocks live Phase 4 verification), Resend account (blocks Phase 5) —
  user action.
- Docker Desktop (blocks local `db:*` / e2e runs) — user action; CI covers both meanwhile.
- Dependabot branches on origin (setup-node-7, upload-artifact-7, gitleaks-action-3,
  pnpm/action-setup-6, supabase/setup-cli-3, dev-deps-*) — noted, awaiting user decision.

## Decisions

| Date       | Decision                                                                       | Rationale                                                                     |
| ---------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 2026-10-13 | Main folder is `D:\Projects\project1`                                          | User instruction.                                                             |
| 2026-10-13 | Remote `origin` = github.com/yassine808/project1                               | User instruction.                                                             |
| 2026-10-13 | Product name: **Facturio**                                                     | User choice; npm name free; .com/.app taken → ship on vercel.app for now.     |
| 2026-10-13 | Core domain: invoice & client manager (default confirmed)                      | User confirmation.                                                            |
| 2026-10-13 | License MIT; local `--no-ff` merges, tag per phase                             | User: "you create everything"; sensible default per brief.                    |
| 2026-10-13 | Accounts: Supabase + Vercel ready; Stripe/Resend pending                       | User answers; creation tracked as blockers per phase.                         |
| 2026-10-13 | No fixed launch deadline                                                       | User choice; estimates in PLAN §8.                                            |
| 2026-10-13 | User installs Docker Desktop themselves                                        | Rule: agent does not install global software.                                 |
| 2026-10-13 | UI built using `impeccable` + `ui-ux-pro-max` skills; dark default + toggle    | User instruction; toggle assumption logged (changeable).                      |
| 2026-10-13 | Email = Resend + Mailpit local; PDF = @react-pdf/renderer; hooks = lefthook    | Phase 0 research; ADRs 0008–0010 to confirm.                                  |
| 2026-10-13 | Test helpers written in-repo (~50 lines), no 3rd-party pgTAP helper dep        | Brief rule: no unexplained dependencies.                                      |
| 2026-10-13 | pgTAP personas use run-unique emails + GUCs, never delete from `auth.users`    | CI-local delete-by-email anomaly (see lessons); deterministic and safe.       |
| 2026-10-13 | Theme vars driven by `.dark` class, not `prefers-color-scheme`                 | Matches layout comment; unlayered body rule paints the page (see lessons).    |
| 2026-10-13 | Tag `v0.1` on the first fully green Phase 1 commit                             | Per plan: one tag per phase.                                                  |
| 2026-10-13 | Invitations are links; no email sending in Phase 2                             | Resend account arrives in Phase 5; raw token shown once, sha256 at rest.      |
| 2026-10-13 | Invite landing page shows nothing pre-acceptance                               | Avoids leaking tenant metadata to link scanners; mismatch error on accept.    |
| 2026-10-13 | No committed Supabase types; query helpers Zod-parse results                   | House rule; SQL drift fails loudly at runtime instead of lying via types.     |
| 2026-10-13 | Anon keeps read grants on tenant tables, policies are `to authenticated`       | Grants precede RLS; zero rows beats a 42501 masking the real semantics.       |
| 2026-10-13 | Invited role limited to member/admin; owners promoted in-app only              | Keeps the last-owner backstop the single authority on owner counts.           |
| 2026-10-13 | Money = integer minor units + basis-point tax rates, one rounding rule         | ADR-0003; totals trigger-computed, no money column has an update grant.       |
| 2026-10-13 | Invoice numbers allocate at draft→sent from a locked per-(org, year) counter   | ADR-0006; rollback returns the number, unnumbered drafts cannot burn one.     |
| 2026-10-13 | Overdue is derived (`sent` + past due_date), never stored                      | No cron, cannot go stale.                                                     |
| 2026-10-13 | Invoice details freeze once sent; status is the only later change              | A sent invoice is a record of what was billed (migration 0009).               |
| 2026-10-13 | Payments: sent-only insert/delete, auto paid-flip, frozen once paid, no UPDATE | Corrections are delete + re-record; settled money is not edited in place.     |
| 2026-10-13 | No payment `method` column in the MVP                                          | YAGNI; amount + date + notes cover the brief, adding a column later is cheap. |
| 2026-10-13 | Dashboard sums grouped per currency, summed in JS from RLS-scoped rows         | Mixed-currency sums would be fake numbers; no aggregate RPC keeps the         |
|            |                                                                                | revoke-the-surface defense intact.                                            |
| 2026-10-13 | Draft editor saves header + lines as one form (update/insert/delete by id)     | One intent per action; delete-last ordering means a mid-save failure never    |
|            |                                                                                | loses rows.                                                                   |
| 2026-10-13 | No client-side confirm dialog on void in the MVP                               | Distinct styled button; the DB transition rule is the authority.              |
| 2026-10-14 | Stripe webhook is the only writer of `subscriptions`; app role is select-only  | ADR-0005; no code path moves a plan without Stripe saying so.                 |
| 2026-10-14 | Plan meter = active clients per org (free 3, pro unlimited)                    | Deterministic (no month-rollover logic), core object; future meters reuse it. |
| 2026-10-14 | `past_due` keeps Pro access                                                    | Dunning retries run for days; locking an org out mid-run helps nobody.        |
| 2026-10-14 | Ledger: process first, record `event.id` last, PK conflict = duplicate         | Handlers are idempotent declarative syncs — even concurrent dupes are safe.   |
| 2026-10-14 | Stripe keys optional in env: missing = documented "billing disabled" mode      | Same honest-disabled pattern as Phase 2 invites; CI needs no Stripe account.  |
| 2026-10-14 | `platform_admins` exists with zero app surface until Phase 6                   | Brief §7.2 lists the table; the admin milestone builds its surface.           |
| 2026-10-14 | Free-plan limit enforced by DB trigger, no app-side pre-check                  | Defense in depth like every rule; one P0001 message reaches the user.         |
