# PROGRESS.md

Status log for the multi-tenant invoice SaaS. Updated at the end of every session.

## Status

**Current phase:** Phase 0 — Plan (in progress)

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

## Next

- User reviews `docs/PLAN.md` → says "approved".
- Before Phase 1: user installs Docker Desktop; create Stripe test account (before Phase 4) and Resend account (before Phase 5).

## Blockers

- Waiting on user approval of the Phase 0 plan before any application code.
- Docker Desktop not yet installed (user action).

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-13 | Main folder is `D:\Projects\project1` | User instruction. |
| 2026-10-13 | Remote `origin` = github.com/yassine808/project1 | User instruction. |
| 2026-10-13 | Product name: **Facturio** | User choice; npm name free; .com/.app taken → ship on vercel.app for now. |
| 2026-10-13 | Core domain: invoice & client manager (default confirmed) | User confirmation. |
| 2026-10-13 | License MIT; local `--no-ff` merges, tag per phase | User: "you create everything"; sensible default per brief. |
| 2026-10-13 | Accounts: Supabase + Vercel ready; Stripe/Resend pending | User answers; creation tracked as blockers per phase. |
| 2026-10-13 | No fixed launch deadline | User choice; estimates in PLAN §8. |
| 2026-10-13 | User installs Docker Desktop themselves | Rule: agent does not install global software. |
| 2026-10-13 | UI built using `impeccable` + `ui-ux-pro-max` skills; dark default + toggle | User instruction; toggle assumption logged (changeable). |
| 2026-10-13 | Email = Resend + Mailpit local; PDF = @react-pdf/renderer; hooks = lefthook | Phase 0 research; ADRs 0008–0010 to confirm. |
| 2026-10-13 | Test helpers written in-repo (~50 lines), no 3rd-party pgTAP helper dep | Brief rule: no unexplained dependencies. |
