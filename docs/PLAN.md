# PLAN.md — Facturio

> Multi-tenant SaaS: invoice & client manager for freelancers and small teams.
> Phase 0 deliverable. **No application code until this plan is approved.**

Status: **awaiting approval** · Created: 2026-10-13 · Owner: yassine808

---

## 1. Scope

### Product (confirmed)
Facturio: freelancers and small teams manage clients, issue professional invoices
(line items, tax, MAD/EUR/USD), track manual payments, and collaborate under one
organization (tenant) with roles. Billing via Stripe Free/Pro plans with enforced limits.

### In scope (MVP)
- Auth: email+password (verified), password reset, Google + GitHub OAuth.
- Organizations (tenants), members, roles (owner/admin/member), expiring single-use invites.
- Clients (archive, not delete), invoices (draft → sent → paid/overdue/void), line items,
  tax, gap-free per-org sequential numbering (`INV-2026-0001`), manual payments.
- Dashboard metrics, list pagination/filter/search.
- Stripe billing (test mode): Checkout, Customer Portal, webhooks, entitlements, usage meters.
- Invoice PDF, email delivery, public read-only share link.
- Org admin pages + read-only platform admin dashboard.
- Docs: README, ARCHITECTURE, DATA_MODEL, THREAT_MODEL, ADRs.

### Out of scope (non-goals)
Native mobile, multi-region, legal e-invoicing compliance (portfolio product — disclaimer
in UI), accounting ledger, SSO/SAML, real-time collaboration, bank sync.
Stretch only: French UI, JSON/CSV export.

---

## 2. Confirmed decisions (Phase 0 answers)

| # | Question | Answer |
|---|---|---|
| 1 | Product name | **Facturio** (npm name free; exact .com/.app taken — ship on `facturio.vercel.app`, revisit domain at launch) |
| 2 | Core domain | Confirm default: invoice & client manager |
| 3 | License / merge flow | **MIT**, local merges with `--no-ff`, tag per phase (decided by builder, per user) |
| 4 | Accounts ready | ✅ Supabase (free), ✅ Vercel. ❌ Stripe test mode — needed before Phase 4. ❌ Resend — needed before Phase 5 (free tier fine) |
| 5 | Time budget | No fixed deadline; milestones sized in effort estimates, not dates |
| 6 | Docker | Docker Desktop **to be installed by user** (link provided; nothing installed by agent) |
| 7 | UI taste | Use `impeccable` + `ui-ux-pro-max` skills when building UI; dark-mode default with toggle (assumed, logged as decision) |
| 8 | Constraints | None beyond brief |

---

## 3. Stack and versions

Versions verified against official docs on 2026-10-13. Exact pins re-checked at scaffold
(Phase 1) and recorded in `package.json` + lockfile.

| Layer | Choice | Version / notes | Why (alternatives: rejected because …) |
|---|---|---|---|
| Runtime | Node.js | v24.15.0 (installed) | LTS line, matches Vercel |
| Package manager | pnpm | 11.1.3 (installed) | Brief default; fast, strict node_modules |
| Framework | Next.js (App Router) | **16.x stable** | Brief default. ⚠️ Verified: middleware renamed → **`proxy.ts`** (Next 16); Supabase session refresh goes in `proxy.ts`. Next 15 `middleware.ts` is deprecated |
| Language | TypeScript strict | 5.x | Brief default |
| UI | Tailwind CSS + shadcn/ui | current | Brief default; shadcn = owned code, no runtime dep |
| Auth/DB | Supabase (Postgres, Auth, RLS) | `@supabase/ssr` 0.12.5 | Brief default. ⚠️ Verified: server-side identity via **`auth.getClaims()`** (validates JWT) — `getSession()` must not gate access |
| Payments | Stripe (test mode) | API `2026-05-27.dahlia`, `stripe` SDK current | Brief default. Verified: raw body (`req.text()`) for signature; idempotency via unique `event.id`; do **not** order events by `created` (Stripe docs) |
| Email (prod) | Resend | free tier (100/day) | Simple TS SDK. Local dev: **Mailpit** local inbox (no Docker needed? — Mailpit runs as binary; verify in Phase 5). Alternative: Postmark (rejected: no free-tier advantage for this scope) |
| PDF | `@react-pdf/renderer` | current | Server-side, no headless browser, works on Vercel serverless. Alternative: Puppeteer/Chrome (rejected: heavy, cold starts) |
| Validation | Zod | v4 line (verify) | Brief default; one schema for client+server |
| Forms | react-hook-form + zod resolver | current | Brief default |
| Lint/format | ESLint (next config) + Prettier | current | Brief default |
| Git hooks | **lefthook** | current | Cross-platform (Windows-friendly, Go binary) — husky/shell hooks are flaky on Windows |
| Commit lint | commitlint (conventional) | current | Brief default |
| Unit/integration tests | Vitest | current | Brief default; fast, ESM-native |
| DB tests | pgTAP via `supabase test db` | Supabase CLI latest | Official path; runs migrations from scratch in CI |
| E2E | Playwright + @axe-core/playwright | current | Brief default |
| CI/CD | GitHub Actions + Vercel | — | Brief default |
| Secrets scan | gitleaks + `pnpm audit` | CI | Brief default |

### ⚠️ Research findings baked into the plan
1. **Next 16 `proxy.ts`**: route protection and Supabase cookie refresh live in `proxy.ts`
   (not `middleware.ts`). Auth check inside it = `getClaims()`/`getUser()`, never `getSession()`.
2. **pgTAP superuser trap**: `supabase test db` connects as superuser (bypasses RLS). Every
   assertion must `set local role authenticated` + set `request.jwt.claims` (or use
   `basejump-supabase_test_helpers` / our own ~50-line `tests.authenticate_as()` helper —
   decision: **write our own helpers**, no third-party test dependency). Test both `USING`
   (read) and `WITH CHECK` (write) with `throws_ok(..., '42501')`.
3. **Stripe webhook ordering**: no `created`-based ordering (seconds granularity, collisions).
   Strategy: unique `event.id` insert **in the same transaction** as the state change;
   monotonic state transitions where possible; otherwise re-fetch the object from Stripe API.

---

## 4. Architecture overview

```
Browser ──► Next.js 16 (Vercel)
             ├── proxy.ts          session refresh + coarse route gate
             ├── Server Components / Server Actions
             │     └── src/features/*  (domain logic, framework-agnostic, Zod at boundary)
             ├── Route Handlers
             │     ├── /api/webhooks/stripe  (raw body → signature verify → idempotent handle)
             │     ├── /api/health
             │     └── /share/[token]        (public, read-only, rate-limited)
             └── Supabase (Postgres + Auth)
                   ├── user-scoped client (RLS always on) — default
                   └── service-role client — server-only module, `import "server-only"`,
                       only for admin bootstrap (webhook events not tied to a user JWT,
                       invite email sends, seed scripts)
```

- **Tenancy**: shared DB, `org_id` on every tenant row, isolation enforced by **RLS**.
  Active org from URL `/app/[orgSlug]/…`; membership checked in RLS, not client claims.
- **Defense in depth**: proxy.ts gate → per-action authorization (auth + membership + role +
  entitlement) → RLS as last line.
- **Money**: integer minor units + ISO 4217 code; rounding rule in ADR-0003.

## 5. Data model (draft — final in docs/DATA_MODEL.md with ERD)

As specified in the brief (section 7.2): `profiles`, `organizations`, `memberships`,
`invitations`, `clients`, `invoices`, `invoice_items`, `invoice_counters`, `payments`,
`subscriptions`, `stripe_events`, `audit_logs`, `platform_admins`.

Refinements:
- `org_id` denormalized onto `invoice_items` **with composite FK**
  (`(invoice_id, org_id)` → `invoices(id, org_id)`) so a child can never reference another
  tenant's parent — checked at DB level, keeps RLS policies single-column and indexable.
- `invoices.currency` + minor-unit columns; `CHECK` constraints on status/date sanity.
- `updated_at` via one shared trigger function; `created_at/updated_at` on every table.
- `subscriptions.plan` as enum (`free | pro`), default `free` (row created on org insert).

## 6. RLS strategy

1. Every table in `public`: `ENABLE ROW LEVEL SECURITY`, no policies ⇒ default deny;
   then exactly one policy per operation (SELECT/INSERT/UPDATE/DELETE).
2. Helper functions (`SECURITY DEFINER`, `set search_path = ''`, minimal, pgTAP-tested):
   `is_org_member(org_id)`, `has_org_role(org_id, roles[])`, `org_role(org_id)`.
   Stored in `public` but with narrow `GRANT EXECUTE` (verify PostgREST exposure in Phase 2 —
   alternative: `private` schema, documented in ADR-0004).
3. **RLS matrix test** (pgTAP): every tenant table × {anon, outsider, member, admin, owner}
   × {SELECT, INSERT, UPDATE, DELETE} → allow/deny, plus attack cases:
   - org A reading/writing org B's rows,
   - moving a row across tenants (`UPDATE … SET org_id`),
   - inserting a child row under another tenant's parent (composite FK must reject),
   - last-owner demotion/removal must fail.
4. Test helpers: own `tests` schema (`create_user`, `authenticate_as`,
   `clear_authentication`) — test-only, never migrated to prod.
5. Trigger enforcing "≥1 owner" as the DB-level backstop for the role rules.

## 7. Environment strategy (free tiers)

| Env | Backend | Frontend | Notes |
|---|---|---|---|
| Local | Supabase CLI + Docker (user installs) | `pnpm dev` | Mailpit inbox, `stripe listen` for webhooks |
| Preview | Supabase project #1 (free tier allows 2) | Vercel preview per PR/push | Demo/resettable data via seed |
| Production | Supabase project #2 (free) | Vercel main | Only after Phase 7 checklist |

- Migrations only via `supabase/migrations`; deploy to hosted DBs = manual, approved workflow.
- CI (GitHub Actions, ubuntu): frozen install → lint → typecheck → unit → `supabase start` →
  migrate from scratch → type-gen freshness check → pgTAP → build → Playwright → gitleaks → audit.
- Free-tier limits to verify at Phase 1 (Supabase: 2 projects, 500 MB DB, 50k MAU;
  Vercel: hobby limits; Resend: 100 emails/day).

## 8. Milestone plan (effort, no dates)

| Phase | Deliverables (abbreviated) | Est. effort | Gate |
|---|---|---|---|
| 0 Plan | this document | done pending approval | user approves |
| 1 Foundation | scaffold, hooks, CI green, env validation, local Supabase, `profiles` migration, auth flows, app shell, `/api/health`, README skeleton | 8–10 h | fresh clone → running in ≤10 min; signup/in/out/reset works; CI green |
| 2 Tenancy & roles | orgs, memberships, invites, org switcher, RBAC (UI+server), audit base, RLS matrix | 10–12 h | outsider blocked; last owner protected; expired/used invites rejected |
| 3 Core domain | clients, invoices, items, totals, numbering concurrency, payments, overdue, dashboard | 14–16 h | money/numbering unit-tested; RLS extended |
| 4 Billing | Stripe plans script, Checkout, Portal, webhooks, entitlements, billing page | 10–12 h | webhook tests (dup/out-of-order/bad sig); limits server-enforced |
| 5 Documents | PDF, email, share link | 6–8 h | PDF test, share link isolated + rate-limited, dev inbox works |
| 6 Admin | usage page, audit viewer, platform admin | 5–6 h | non-admins 404/403; access audited |
| 7 Harden & launch | security pass, rate limits, Lighthouse+axe, demo account, prod deploy, README, CHANGELOG, v1.0.0 | 8–10 h | §14 definition of done project-wide |
| **Total** | | **~61–74 h** | |

## 9. Risk register

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | Docker Desktop install issues on Windows (WSL2) | high | Install early (already requested); if blocked, fallback: hosted Supabase only (logged trade-off) |
| R2 | Supabase/Next.js fast-changing APIs → stale patterns | med | Docs re-checked at each phase start; versions recorded |
| R3 | pgTAP superuser trap → false-green RLS tests | high | Mandatory role-switch helper; assert `current_user = 'authenticated'` in test blocks |
| R4 | Stripe test account not created yet | med | Needed before Phase 4; user creates (needs bank-less test signup) |
| R5 | Free member cap (1) vs demo "invite teammate" flow | med | Demo path: test-mode upgrade to Pro before inviting; documented in README demo script |
| R6 | Gap-free numbering under concurrency | med | Allocate inside transaction with `FOR UPDATE` on `invoice_counters`; pgTAP concurrency test |
| R7 | Windows dev vs Linux CI differences (line endings, hooks) | low | `.gitattributes`, lefthook, CI as source of truth |
| R8 | No deadline → scope creep | med | Phase gates; stretch items explicitly last |
| R9 | Domain taken (facturio.com/.app) | low | Ship on vercel.app; domain decision at launch |

## 10. ADRs to write (in docs/adr/)

1. 0001 Next.js 16 + App Router + `proxy.ts` (vs Pages/other frameworks)
2. 0002 Supabase RLS multi-tenancy (vs app-layer isolation / Postgres RLS w/ separate schemas / per-tenant DB)
3. 0003 Money representation and rounding rule (minor units; per-line rounding, half-up — verify tax expectations)
4. 0004 RLS helper function schema + grants
5. 0005 Stripe as source of truth via webhooks (vs bidirectional sync)
6. 0006 Invoice numbering strategy (counter row + row lock vs sequence per org)
7. 0007 Rate limiting approach (Upstash Redis free vs DB counter vs Vercel KV)
8. 0008 Email provider + local inbox (Resend + Mailpit)
9. 0009 PDF generation (`@react-pdf/renderer` vs headless Chrome)
10. 0010 Git hooks (lefthook vs husky)
11. 0011 Server-only secrets pattern (`import "server-only"`, env validation with Zod)

## 11. Definition of "MVP done"

All section-14 checkboxes hold project-wide **and** a stranger can, without help: sign up,
create an org, upgrade (test mode), invite a teammate, create a client + invoice, issue it,
download the PDF, open the share link, and read a README that explains tenant isolation,
billing, tests and CI/CD with real numbers.
