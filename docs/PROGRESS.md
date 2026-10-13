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

## Next

- Answer Phase 0 question batch (name, domain confirm, accounts, time budget, Docker, UI taste).
- Write `docs/PLAN.md` and stop for approval.

## Blockers

- Waiting on user approval of the Phase 0 plan before any application code.

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-13 | Main folder is `D:\Projects\project1` | User instruction. |
| 2026-10-13 | Remote `origin` = github.com/yassine808/project1 | User instruction. |
