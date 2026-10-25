# AGENTS.md — Conventions for AI Agents

Project: **Facturio** — multi-tenant SaaS invoice & client manager (portfolio for yassine808).
The original build brief supersedes this file where more specific. Current phase/blockers: `docs/PROGRESS.md`.

## Session continuity

- Start: read `AGENTS.md`, `docs/PLAN.md`, `docs/PROGRESS.md`.
- End: update `docs/PROGRESS.md` (done / next / blockers / decisions).

## Commands (pnpm only, never npm/yarn)

```
pnpm lint && pnpm typecheck && pnpm test && pnpm check:env   # local gate before claiming "done"
pnpm build                                                    # needs .env present (placeholders OK locally)
pnpm dev                                                      # next dev on :3000
# NOTE: `typecheck` runs `next typegen` first — route types (LayoutProps) live in
# .next/types and do NOT exist on a fresh clone. Never drop typegen from the script.
pnpm db:start → pnpm db:env → pnpm db:reset → pnpm test:db    # local Supabase flow (needs Docker)
pnpm test:e2e                                                 # Playwright; builds+starts server unless PLAYWRIGHT_BASE_URL set
```

- Verify order matters: `lint → typecheck → test → check:env → build`. Report real results; say plainly when
  something fails or is skipped.
- **Docker is not installed on this Windows machine** → `db:start/reset/test:db/types` and full e2e cannot run
  locally. CI (ubuntu, Docker available) is the verification path for those — do not claim them locally.
- CI = 9 checks in `.github/workflows/ci.yml` (lint, typecheck, vitest, check:env, audit, gitleaks, migrations +
  pgTAP, build, e2e). If CI fails: stop, read the actual log, diagnose — never guess a fix and re-run blindly.

## Environment & secrets

- Only `.env.example` is tracked. `.env` / `.env.local` are gitignored — never commit them, never paste real
  keys into code, logs, or docs. `pnpm check:env` enforces this (plus secret patterns, env-var drift).
- `.env` exists locally with placeholders; after `pnpm db:start` run `pnpm db:env` to write real local keys
  into `.env.local` (it overwrites, never commits).

## Next.js 16 / Supabase quirks (easy to get wrong)

- `src/proxy.ts` — NOT `middleware.ts` (renamed in Next 16). It refreshes the session cookie and gates
  `/app/*` + `/admin/*`; on redirect it must carry `supabaseResponse` cookies across.
- Server auth: `supabase.auth.getUser()` (verifies with Auth server). Never `getSession()` — trusts the cookie.
- `cacheComponents` is deliberately OFF in `next.config.ts` (fully dynamic app) — don't re-enable without an ADR.
- Dark mode = `html class="dark"` + `@custom-variant dark` in `globals.css`, not OS preference.
- Email confirmation link → `/auth/confirm?token_hash=…` (verifyOtp); OAuth → `/auth/callback` (PKCE code).

## Database / RLS

- Every new table: RLS enabled, default deny, one policy per operation, plus a pgTAP test in
  `supabase/tests/database/` (migrations only in `supabase/migrations/`).
- **pgTAP superuser trap**: test runner is superuser (bypasses RLS). Every assertion must first
  `set local role` + set `request.jwt.claims` (helpers in `000-setup.test.sql`) or results are false-green.
  Test both `USING` (reads/updates → `results_eq`/`is_empty`) and `WITH CHECK` (bad inserts → `throws_ok '42501'`).
- Money = integer minor units + ISO 4217. Never floats.

## Git

- Identity (local config, never commit as anyone else): `yassine808` / `166349232+yassine808@users.noreply.github.com`
- Remote: `origin` = https://github.com/yassine808/facturio.git
- Add files **individually** (no `git add .`). Small Conventional Commits (commitlint runs via lefthook).
- `main` always deployable; branches `feat/…`, `fix/…`, `chore/…`, `docs/…`; merge `--no-ff`; tag `v0.x` per phase.
- Line endings pinned LF via `.gitattributes` (Windows dev + Linux CI).

## Workflow

- **One phase at a time.** Stop at each phase end: summarize (built / how tested / real results / next), wait
  for review. No fake progress: no TODO stubs as finished, no mock data in prod paths (demo data = seed only).
- Ask rarely, ask well: default is pick a sensible option, log it in `docs/PROGRESS.md` (Decisions), continue.
  Ask only for destructive/irreversible actions, money, secrets, security trade-offs, scope changes.
- Everything (code, comments, docs, commits) in **English**. Comments explain _why_, junior-to-mid audience.
- Domain logic lives in `src/features/*` (framework-agnostic, unit-testable). Zod at every boundary;
  authorization re-checked in every server action. Major dependency ⇒ short ADR in `docs/adr/`.
- Read current official docs before using Next/Supabase/Stripe APIs — they change fast (versions pinned in
  `docs/PLAN.md`).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
