# AGENTS.md — Conventions for AI Agents

Project: multi-tenant SaaS invoice & client manager (portfolio project for yassine808).
Full brief: see the original build brief (supersedes this file where more specific).

## Session continuity
- Start of session: read `AGENTS.md`, `docs/PLAN.md`, `docs/PROGRESS.md`.
- End of session: update `docs/PROGRESS.md` (done / next / blockers / decisions).

## Non-negotiable rules
1. **Plan first.** No application code until Phase 0 plan (`docs/PLAN.md`) is approved.
2. **One phase at a time.** Stop at each phase end: summarize (what was built, how to run, test results, next) and wait for review.
3. **Verify, don't assume.** Before saying "done": run lint, typecheck, tests, build — report real results. Say plainly when something is skipped or fails.
4. **Check current docs.** Next.js / Supabase / Stripe change fast. Read official docs before using an API. Record versions in `docs/PLAN.md`.
5. **Ask rarely, ask well.** Default: pick sensible option, log it in `docs/PROGRESS.md` (Decisions), continue. Ask only for: destructive/irreversible actions, costs money, secrets, security-sensitive trade-offs, scope changes.
6. **Small commits**, one concern each, Conventional Commits.
7. **Keep it simple.** No microservices, no premature abstraction. Major dependency ⇒ short ADR.
8. **No fake progress.** No TODO stubs as finished work, no mock data in production paths. Demo data only via seed script.
9. **Safety.** No destructive commands, no production data, no secrets in code/logs, never commit `.env*` (only `.env.example`), announce anything global before installing.
10. Everything (code, comments, docs, commits) in **English**.

## Git
- Identity (local config, never commit as anyone else):
  - `user.name`: `yassine808`
  - `user.email`: `166349232+yassine808@users.noreply.github.com`
- Remote: `origin` = https://github.com/yassine808/project1.git
- `main` always deployable. Branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Merge locally with `--no-ff` unless told otherwise. Tag `v0.x` per phase end, `v1.0.0` at launch.

## Code conventions
- TypeScript `strict`, English comments that explain *why* (no clever one-liners).
- Domain logic in `src/features/*`, framework-agnostic and unit-testable.
- Zod validation at every boundary; server-side authorization in every server action.
- Money = integer minor units + ISO 4217 currency. Never floats.
- Every new table: RLS enabled, one policy per operation, default deny, pgTAP tests.
- Non-obvious decisions get a short explanation (why, alternatives, trade-offs) — assume junior-to-mid audience.

## Repo layout target
See section 11 of the build brief (docs/, supabase/, src/, e2e/, scripts/, .github/).
