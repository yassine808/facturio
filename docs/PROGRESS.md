# PROGRESS.md

Status log for the multi-tenant invoice SaaS. Updated at the end of every session.

## Status

**Current phase:** Phase 2 — Organizations, members, invitations, audit (implementation complete, awaiting user review)

Work lives on branch `feature/phase-2-tenancy` (PR #7). CI green on the full phase: all 9 checks
pass (run 38455143709, commit `710288a`), pgTAP included (5 files). `main` still points at Phase 1
(tag `v0.1`); the phase merge happens after review.

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

## Next

- User reviews Phase 2 (branch `feature/phase-2-tenancy`, PR #7) → says "approved" →
  `--no-ff` merge to `main` + tag `v0.2`.
- Phase 3: clients + invoices (money as integer minor units + ISO 4217, PDF in Phase 5).
- Before Phase 4: Stripe test account. Before Phase 5: Resend account.
- Docker Desktop still not installed locally → DB/e2e verified in CI only.

## Blockers

- Waiting on user review of Phase 2 before merging and starting Phase 3 (phase-gate rule).
- Stripe test account (blocks Phase 4), Resend account (blocks Phase 5) — user action.
- Docker Desktop (blocks local `db:*` / e2e runs) — user action; CI covers both meanwhile.

## Decisions

| Date       | Decision                                                                    | Rationale                                                                  |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2026-10-13 | Main folder is `D:\Projects\project1`                                       | User instruction.                                                          |
| 2026-10-13 | Remote `origin` = github.com/yassine808/project1                            | User instruction.                                                          |
| 2026-10-13 | Product name: **Facturio**                                                  | User choice; npm name free; .com/.app taken → ship on vercel.app for now.  |
| 2026-10-13 | Core domain: invoice & client manager (default confirmed)                   | User confirmation.                                                         |
| 2026-10-13 | License MIT; local `--no-ff` merges, tag per phase                          | User: "you create everything"; sensible default per brief.                 |
| 2026-10-13 | Accounts: Supabase + Vercel ready; Stripe/Resend pending                    | User answers; creation tracked as blockers per phase.                      |
| 2026-10-13 | No fixed launch deadline                                                    | User choice; estimates in PLAN §8.                                         |
| 2026-10-13 | User installs Docker Desktop themselves                                     | Rule: agent does not install global software.                              |
| 2026-10-13 | UI built using `impeccable` + `ui-ux-pro-max` skills; dark default + toggle | User instruction; toggle assumption logged (changeable).                   |
| 2026-10-13 | Email = Resend + Mailpit local; PDF = @react-pdf/renderer; hooks = lefthook | Phase 0 research; ADRs 0008–0010 to confirm.                               |
| 2026-10-13 | Test helpers written in-repo (~50 lines), no 3rd-party pgTAP helper dep     | Brief rule: no unexplained dependencies.                                   |
| 2026-10-13 | pgTAP personas use run-unique emails + GUCs, never delete from `auth.users` | CI-local delete-by-email anomaly (see lessons); deterministic and safe.    |
| 2026-10-13 | Theme vars driven by `.dark` class, not `prefers-color-scheme`              | Matches layout comment; unlayered body rule paints the page (see lessons). |
| 2026-10-13 | Tag `v0.1` on the first fully green Phase 1 commit                          | Per plan: one tag per phase.                                               |
| 2026-10-13 | Invitations are links; no email sending in Phase 2                          | Resend account arrives in Phase 5; raw token shown once, sha256 at rest.   |
| 2026-10-13 | Invite landing page shows nothing pre-acceptance                            | Avoids leaking tenant metadata to link scanners; mismatch error on accept. |
| 2026-10-13 | No committed Supabase types; query helpers Zod-parse results                | House rule; SQL drift fails loudly at runtime instead of lying via types.  |
| 2026-10-13 | Anon keeps read grants on tenant tables, policies are `to authenticated`    | Grants precede RLS; zero rows beats a 42501 masking the real semantics.    |
| 2026-10-13 | Invited role limited to member/admin; owners promoted in-app only           | Keeps the last-owner backstop the single authority on owner counts.        |
