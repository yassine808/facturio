# ADR-0007: Rate limiting with a Postgres counter table

- **Status:** accepted (2026-10-15, Phase 5)
- **Decider:** yassine808 + agent, per PLAN §10 item 7 ("Upstash Redis
  free vs DB counter vs Vercel KV") and the Phase 5 acceptance "share
  link isolated + rate-limited"

## Context

The Phase 5 share route (`/share/[token]`) is public and unauthenticated:
anyone holding a link can hit it as fast as their client allows. Scraping
one invoice's line items, or probing the token space, must be bounded.
Whatever mechanism we pick must behave identically in local dev, in CI,
and on Vercel — the plan's own risk register (R1, R7) already penalizes
"works on my machine only" infrastructure.

## Decision

**A `rate_limits` table plus one SECURITY DEFINER function,
`rate_limit_hit(p_key, p_limit, p_window_seconds) → boolean`, called
before the request touches anything else.**

- The function atomically upserts the bucket in one statement:
  `insert into rate_limits … on conflict (key) do update set count =
case when window expired then 1 else count + 1 end, window_start = …
returning count <= p_limit`. One round trip, no read-then-write race.
- The table is invisible to the app: RLS enabled, zero policies, and
  every grant revoked from `anon`/`authenticated` — the definer function
  (owner `postgres`) writes it, superuser tests read it. Same pattern as
  `invoice_counters` (ADR-0006).
- `execute` is revoked from `PUBLIC` and granted only to `anon` and
  `authenticated` (ADR-0004 helper discipline).
- The share route calls it **first**, with key
  `share:{token_hash}:{ip}` — the raw token never reaches the table
  (hash-at-rest, matching ADR-0012), and the IP comes from the first
  `x-forwarded-for` hop (Vercel sets it; localhost in dev). Budget: 30
  requests / 60 s.
- **Fail closed:** if `rate_limit_hit` errors, the route answers 429.
  An errored limiter means we cannot prove the caller is inside budget.

## Alternatives considered

- **Upstash Redis (free tier):** lowest latency at scale, but a new
  service, a new account (another user blocker), a network hop per
  request, and a local/CI story that silently diverges from production.
  Rejected.
- **Vercel KV:** same infra divergence, plus pins core security behavior
  to the deployment platform — moving hosts would move our security.
  Rejected.
- **In-process counter:** serverless functions share no memory; each
  instance would grant its own full budget, making the limit cosmetic.
  Rejected.
- **No limiting:** the token is 256 bits of entropy, but rate limiting
  also stops scraping a _known_ link and gives the share surface a
  defense even if a token leaks. Rejected.

## Consequences

- One extra RPC round trip per share request — negligible next to
  rendering.
- Bucket rows persist after their window; each row is tiny and keys are
  bounded by (token, ip). Opportunistic pruning of stale rows is noted
  in the plan backlog (Phase 6/7), not built now (YAGNI).
- Any future public endpoint reuses the same function with a new key
  prefix — no second mechanism.
- pgTAP 120 pins: anon may execute the function, the table itself is
  unreadable/unwritable by app roles, under-limit → `true`, at-limit →
  `false`, and an expired window resets the count.
