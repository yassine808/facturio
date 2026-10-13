# ADR-0001: Disable Next.js `cacheComponents`

- **Status:** accepted (2026-10-13, Phase 1)
- **Deciders:** yassine808 + agent, per build brief

## Context

Next.js 16 ships `cacheComponents: true` as the direction of travel. Turning it on
forces every cookie/dynamic read (our Supabase session reads, auth pages, `/app`)
into explicit `<Suspense>` boundaries, and the whole Facturio app is authenticated
and dynamic by nature: no static benefit from the cache, only wrapper ceremony.

## Decision

Keep `cacheComponents` **off** in `next.config.ts` (commented there with this ADR
reference). Rely on the default rendering behavior: authenticated routes are
server-rendered per request; the marketing homepage stays statically prerendered.

## Alternatives considered

- **Enable it now:** more future-proof, but buys nothing today and adds Suspense
  plumbing to every auth flow before the product even exists. Revisit if Next makes
  it non-optional or we need PPR for the marketing pages.
- **Full static generation:** impossible for cookie-reading authenticated pages.

## Consequences

- If a future Next major removes the flag, migration is a focused pass adding
  Suspense boundaries around dynamic reads (tracked when upgrade pressure appears).
- `next build` output marks `/login`, `/app`, `/auth/*` as dynamic (ƒ) — expected.
