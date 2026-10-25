# Facturio

Multi-tenant invoice & client manager for freelancers and small teams —
portfolio project by [yassine808](https://github.com/yassine808).

**Status:** in development, phase by phase (see [`docs/PROGRESS.md`](docs/PROGRESS.md) for the
current phase and [`docs/PLAN.md`](docs/PLAN.md) for scope/architecture). Not a real
invoicing service — no warranty, MIT licensed.

## Stack

- **Next.js 16** (App Router, TypeScript strict, React 19) + Tailwind CSS 4
- **Supabase** (Postgres, Auth, RLS) — local via Docker, hosted on Vercel
- **Zod** at every boundary · integer minor units for all money (never floats)
- **Playwright** (e2e + axe accessibility) · **Vitest** (unit) · **pgTAP** (RLS tests)
- CI: GitHub Actions — 9 checks on every push/PR

## Quickstart (≤10 minutes)

Prerequisites: **Node ≥24**, **pnpm**, **Docker Desktop** (for the local database).

```bash
git clone https://github.com/yassine808/facturio.git
cd facturio
pnpm install                 # installs deps + git hooks (lefthook)
cp .env.example .env         # placeholders; .env is git-ignored
pnpm db:start                # first run pulls Docker images (~2 min)
pnpm db:env                  # writes real local keys into .env.local
pnpm db:reset                # applies migrations from scratch
pnpm dev                     # http://localhost:3000
```

Smoke check: <http://localhost:3000/api/health> returns
`{ "status": "ok", "env": "ok", "supabase": "up" }`.

## Verification commands

```bash
pnpm lint                    # ESLint
pnpm typecheck               # next typegen + tsc --noEmit
pnpm test                    # Vitest unit tests
pnpm check:env               # no .env tracked, env vars documented, no secret patterns
pnpm build                   # production build
pnpm test:db                 # migrations + pgTAP RLS tests (needs pnpm db:start)
pnpm test:e2e                # Playwright smoke + accessibility (builds first)
```

Order matters: `lint → typecheck → test → check:env → build`. All of these run in CI
(`.github/workflows/ci.yml`); local Windows and CI Linux are normalized via `.gitattributes`.

## Project layout

```
src/
  proxy.ts          # Next 16 middleware equivalent: session refresh + route gate
  app/              # routes (marketing, /login…, /app/*, /auth/*, /api/health)
  features/         # domain logic per feature (auth first), unit-testable
  components/       # shared UI
  lib/              # env schema, logger, supabase clients
supabase/
  migrations/       # SQL migrations (RLS on every table)
  tests/database/   # pgTAP RLS tests (runner is superuser — see AGENTS.md)
e2e/                # Playwright tests
docs/               # PLAN, PROGRESS, ADRs
```

## Contributing / agents

Read [`AGENTS.md`](AGENTS.md) first — it contains the exact commands, phase-gate
workflow, and the Next 16 / Supabase / pgTAP gotchas that are easy to get wrong.

## License

MIT — see [LICENSE](LICENSE).
