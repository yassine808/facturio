# ADR-0008: Email via Resend API (prod), Mailpit/SMTP (dev), honest disabled mode

- **Status:** accepted (2026-10-15, Phase 5)
- **Decider:** yassine808 + agent, per build brief decision "Email =
  Resend + Mailpit local" and PLAN §6/§10 item 8

## Context

Phase 5 must deliver invoices by email, and the plan's acceptance for the
milestone is "dev inbox works" — a developer has to _see_ the email
without a production account. Constraints carried from earlier phases:
no Resend account exists yet (user blocker), CI has no secrets, and the
project forbids fake progress (Phase 2 set the precedent: an honestly
"disabled" flow instead of a silent no-op).

## Decision

**One send path with a transport chosen by configuration, and a
documented disabled mode when neither transport exists.**

- `sendInvoiceEmail` (server action) builds the message once in
  `email/render.ts` — subject, text + HTML body, and the PDF attachment
  from ADR-0009 — then `email/send.ts` picks the transport:
  1. `RESEND_API_KEY` set → the official **`resend` SDK** against the
     HTTP API (PLAN §6: "Simple TS SDK"; API gives structured errors and
     is the provider's blessed path).
  2. else `EMAIL_SMTP_URL` set (dev: `smtp://127.0.0.1:1025`) →
     **`nodemailer`** delivering to **Mailpit**, the plan's local inbox.
     Mailpit ships as a standalone binary (no Docker — answering the
     plan's open question); the user installs it.
  3. else → **disabled**: the action returns an explicit "email is not
     configured" message and the UI offers the share link to copy —
     same honest-degraded pattern as Phase 2 invitations.
- Rules: only invoices with `status = 'sent'` can be emailed (a bill
  does not exist before it is issued), any member may send (same
  authority as issuing the invoice — Phase 3 made issuing member-level),
  recipient = the client's email, body includes the public share link
  (ADR-0012) and attaches the PDF (ADR-0009).
- `EMAIL_FROM` is required alongside the key; Resend's sender-verification
  rules (test mode: their onboarding domain) are documented in
  `.env.example`, not re-implemented.
- **No email-log table in the MVP:** `invoices.sent_at` and
  `share_links.created_at` already answer "was it sent, when, through
  which link". Revisit only if bounce/complaint tracking becomes real.

## Alternatives considered

- **SMTP-only through Resend's SMTP endpoint with nodemailer for both
  transports:** one code path, but SMTP is a secondary offering at
  Resend, the plan chose the SDK, and mixing credentials across two
  providers' mental models adds setup steps. Rejected for MVP.
- **Hand-rolled SMTP client (Node `net` + ~80 lines) for Mailpit:**
  zero deps, but re-invents what nodemailer has hardened for a decade.
  Rejected (ponytail: reuse before custom).
- **Capture-to-file instead of Mailpit:** fails the explicit acceptance
  "dev inbox works". Rejected.
- **Postmark/Mailgun instead of Resend:** PLAN §6 already rejected them
  (no free-tier advantage for this scope). No new evidence.

## Consequences

- Two new dependencies, both named in the plan: `resend` (official SDK)
  and `nodemailer` (+ its types) — explained here per the brief's "no
  unexplained dependencies" rule.
- The env matrix (`RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_SMTP_URL`)
  is documented in `.env.example`; CI and e2e run in disabled mode and
  assert the fallback UI, never a send.
- Live sending stays blocked on the user's Resend account; the local
  demo stays blocked on the user installing Mailpit. Both are tracked in
  PROGRESS blockers — the code paths and unit tests need neither.
