# ADR-0009: Invoice PDFs rendered server-side with @react-pdf/renderer

- **Status:** accepted (2026-10-15, Phase 5)
- **Decider:** yassine808 + agent, per PLAN §6 ("`@react-pdf/renderer`
  vs Puppeteer/Chrome") and §10 item 9

## Context

The MVP-done checklist (PLAN §11) requires a stranger to "download the
PDF" of an invoice, and the Phase 5 email must attach that same PDF. The
deployment target is Vercel's serverless functions: no long-lived
processes, cold starts, and a hard function-size budget — a headless
browser is exactly the wrong shape for that environment.

## Decision

**Render PDFs in-process with `@react-pdf/renderer` v4 (`renderToBuffer`)
from React components, in a GET route handler next to the invoice.**

- Route `GET /app/[orgSlug]/invoices/[invoiceId]/pdf` uses the ordinary
  cookie-based Supabase client, so **RLS is the authorization**: the PDF
  is visible to exactly whoever can see the invoice page — no separate
  permission surface to get wrong. Not a server action (actions return
  form states, not files) and not a public route (the public read is the
  share RPC, ADR-0012).
- The document component renders the same rows the invoice page reads:
  number (or "Draft"), dates, client, line table, and subtotal / tax /
  total. Money is formatted from integer minor units with the existing
  `formatMinor()` helper; totals are the DB-computed columns, so page and
  PDF cannot drift — both are projections of one source.
- The email transport (ADR-0008) attaches the **same**
  `renderToBuffer` output — one renderer, two consumers.
- Filename: `Facturio-INV-2026-0001.pdf` when numbered, a draft-stable
  name otherwise; served as `application/pdf` with
  `Content-Disposition: attachment`.
- Test: a vitest smoke test renders a minimal document and asserts the
  `%PDF-` magic bytes and a non-trivial size — no browser, no network.

## Alternatives considered

- **Puppeteer/headless Chrome:** the plan's explicit alternative.
  Rejected — heavyweight dependency, needs a matching Chromium in CI,
  cold-start and serverless-fragility problems, and PDF output only
  differs by rendering the same HTML twice.
- **Client-side print-to-PDF:** no email attachment (the acceptance
  requires one) and layout depends on each user's browser. Rejected.
- **External PDF API:** another account, another outage dependency, and
  invoice data (client names, amounts) leaving the trust boundary.
  Rejected.

## Consequences

- `@react-pdf/renderer` brings `pdfkit` in transitively; bundle impact
  is confined to the route (dynamic import keeps it out of the client
  bundle — the module is server-only by import location).
- Built-in Helvetica covers Latin-1 (enough for MVP currencies, `€`
  included); non-Latin content (e.g. Arabic line items) would need an
  embedded font — noted, not built.
- CI proves rendering on every push via the unit smoke test; the e2e
  suite downloads the seeded invoice's PDF and checks the response.
