# ADR-0012: Public share links resolve through one definer RPC, not anon policies

- **Status:** accepted (2026-10-15, Phase 5)
- **Decider:** yassine808 + agent, new boundary not covered by the
  plan's ADR list (§10) — the share route is the first _public_ read of
  tenant data, so it deserves its own record

## Context

Phase 5 adds `/share/[token]`: an unauthenticated, read-only view of one
invoice (header, lines, client name, org name), reachable from emails.
Today `anon` holds read grants on tenant tables but zero RLS policies,
so it reads nothing (decided in Phase 2: grants before RLS, zero rows
beats a 42501). Opening this data publicly means deciding _how_ anon
reads — and this project treats every trust boundary as defense in
depth (ADR-0002): column grants → RLS → triggers → action checks → UI.

## Decision

**A single SECURITY DEFINER function `shared_invoice(p_token) → jsonb`
granted to `anon` is the only public read surface; `share_links` stores
only the SHA-256 of the token.**

- `share_links (id, org_id, invoice_id, token_hash, created_by,
expires_at, revoked_at, created_at)` with the house composite FK
  `(invoice_id, org_id)`. The raw token (32 random bytes, URL-safe) is
  shown exactly once at creation — same rule as invitation links
  (Phase 2); the database can never leak what it does not hold.
- The RPC computes `sha256(p_token)` and selects the row where the hash
  matches **and** `revoked_at is null` **and** `expires_at > now()`,
  then returns a fixed projection: org name; invoice number, dates,
  currency, subtotal/tax/total (DB-computed minors); client name; line
  items. Invalid, expired, revoked, and nonexistent all return `null` —
  no oracle distinguishing "wrong token" from "revoked link".
- `shared_invoice` is `revoke … from PUBLIC` + granted **to `anon`
  only** (authenticated users go through the app, never this surface)
  — ADR-0004 helper discipline. The function validates in one `WHERE`
  clause: hash, not revoked, not expired, plus a status gate (links exist
  only for sent/paid invoices, enforced by trigger on insert).
- App writes: authenticated members get `insert` (creation, with
  org/ invoice with-check policy), `select` (list links for their
  invoice), and column-limited `update` for `revoked_at` (revocation).
  `anon` gets **zero** grants on the table.
- The route rate-limits first (ADR-0007) and only then calls the RPC.
  The raw token appears in the URL only — never in logs, tables, or
  keys.
- Authority: members may create/revoke links — a share link is part of
  issuing an invoice (the same authority as emailing it), not a setting.

## Alternatives considered

- **Anon SELECT policies on `invoices`/`invoice_items`/`clients` keyed
  by `current_setting('share.token')`:** spreads the public boundary
  across every table the page touches — each future table (payments,
  notes…) is one forgotten policy away from leaking, and per-row token
  matching does a hash computation on every candidate row. Rejected.
- **Rendering the page with the service-role client:** places the
  service-role key on an unauthenticated request path — the largest
  blast radius the repo could have (ADR-0005 keeps that key inside the
  webhook for exactly this reason). Rejected.
- **Storing the raw token:** simpler joins, but one DB/log exposure
  hands out permanent access to every link ever made. Rejected.

## Consequences

- pgTAP 110 pins the whole matrix: valid token → projection; wrong,
  expired, revoked, other-invoice → `null`; anon can execute the RPC but
  cannot touch `share_links` directly; authenticated cannot execute it;
  the status trigger refuses links on drafts.
- Revocation and expiry take effect on the very next request (nothing is
  cached in app memory).
- Email links older than the 30-day expiry stop working by design; the
  invoice page's share section says so and can mint a fresh link.
- One function is the audit surface: anyone reviewing "what does the
  public see" reads a single `WHERE` clause.
