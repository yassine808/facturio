# ADR-0003: Money as integer minor units with one documented rounding rule

- **Status:** accepted (2026-10-13, Phase 3)
- **Decider:** yassine808 + agent, per build brief ("integer minor units + ISO 4217, never floats")

## Context

Invoices are financial records: totals must be exact, reproducible, and
identical in the database, the UI, the PDF (Phase 5), and any future
export. Floating-point arithmetic (`float8`, or `numeric` math that
rounds at unpredictable points) makes "the same invoice sums two
different ways" possible, and money bugs in billing systems are
silent until an accountant notices. The brief already fixes the
representation (minor units, ISO 4217) — this ADR fixes the _math_
rules the whole app must follow.

## Decision

**All money values are integers in the currency's minor unit; all
currency codes are ISO 4217 three-letter strings constrained to the
MVP set (`MAD`, `EUR`, `USD`). Every rounding step uses Postgres
`round(numeric)` — half away from zero — and rounding happens in
exactly one place per number.**

- Columns: `*_minor bigint` (never `numeric` with fractional scale,
  never `float`); `currency char(3)` with a `CHECK (currency in
('MAD','EUR','USD'))`. `bigint` over `integer` because 2^31 minor
  units (~21M EUR) is uncomfortably close to real invoice totals in
  aggregate sums; the ceilings on `quantity`/`unit_price_minor` keep
  `quantity * price` safely inside `bigint`.
- The canonical pipeline, implemented once as DB triggers on
  `invoice_items` (see `20261013130200_invoice_items.sql`):

  ```
  line_total = round(quantity * unit_price_minor)   -- per line
  subtotal   = sum(line_total)
  tax        = round(subtotal * tax_rate_bps / 10000)
  total      = subtotal + tax
  ```

  `tax_rate_bps` is an integer in basis points (2000 = 20%) — rates
  themselves are never floats.

- Rounding is **per line, then per invoice tax** (not per unit): each
  line rounds once, the invoice tax rounds once. Totals are therefore
  deterministic no matter what order lines are edited in.
- The app never computes or stores totals: `subtotal_minor`,
  `tax_minor`, `total_minor`, and `line_total_minor` carry **no update
  grant**; triggers own them (a trigger assignment is not
  privilege-checked against the caller). Changing `tax_rate_bps`
  recomputes tax/total in-row, closing the one drift path item
  triggers cannot see.
- Minor-unit display (MAD's 2 decimals, etc.) is a rendering concern;
  the `currency` column plus the integer value are sufficient to
  format anywhere, including `@react-pdf/renderer` output in Phase 5.

## Alternatives considered

- **`numeric(14,2)` columns:** exact too, but invites per-column
  scale drift, `0.1 + 0.2`-style surprises in app-layer math, and
  two representations (DB numeric vs JS number) to reconcile. Rejected.
- **App-computed totals stored on write:** one trusted layer, but any
  bug (or malicious PostgREST call) writes arbitrary totals; the DB
  cannot verify "totals match lines" cheaply. Rejected.
- **Float8 for convenience:** exact only until it isn't. Banned
  outright by the brief.

## Consequences

- pgTAP (080) pins the rounding rule at the half boundary
  (`1.5 * 9999 = 14998.5 → 14999`) and every recompute path.
- The Phase 5 PDF and Phase 6 dashboard read the same stored integers
  the app does — one source of truth, zero reconciliation code.
- Adding a currency is a one-line `CHECK` migration plus its ISO
  minor-unit exponent in the UI formatter.
