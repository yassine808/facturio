# ADR-0005: Stripe as source of truth via webhooks only

- **Status:** accepted (2026-10-14, Phase 4)
- **Decider:** yassine808 + agent, per build brief ("Stripe = source of
  truth via webhooks only")

## Context

Subscriptions change on Stripe's side as much as ours: renewals, card
failures (dunning), cancellations from the Portal, plan swaps. There are
two ways to know the current plan of an org:

1. **Ask Stripe on every decision** (lazy fetch / bidirectional sync):
   every entitlement check becomes a network call to a third party —
   latency on every page, hard failure when Stripe or the network is
   down, and still no protection against stale reads after a change
   Stripe made microseconds ago.
2. **Mirror Stripe's events into our own tables** and treat the DB copy
   as the read model: entitlement checks become a local indexed read
   that works even while Stripe is unreachable, and every plan change
   arrives as a discrete, auditable event.

The brief mandates (2). The engineering reasons agree with it.

## Decision

**Stripe owns subscription state; the webhook handler is the only code
path allowed to change `public.subscriptions`; everything else reads
the local copy.**

- `subscriptions` has exactly one row per org, born `free` by a
  SECURITY DEFINER trigger on org insert (the same bootstrap pattern as
  `memberships`). Authenticated gets a **select grant and nothing
  else** — no INSERT/UPDATE/DELETE grant, no policies for writes. No
  app code path, session action, or buggy client can move an org
  between plans; only the webhook (service_role) can.
- `stripe_events (id, type, received_at)` is the idempotency ledger.
  Stripe delivers **at least once** and does **not** guarantee ordering,
  so the handler is: verify signature → process → record `event.id`
  **last**. A conflicting insert on a retry means "already handled" →
  ack 200 and skip. Handlers are declarative syncs (`set plan = 'pro'`,
  `set plan = 'free'`), so even a rare double-apply between two
  concurrent duplicates is harmless.
- Consumed events: `checkout.session.completed` (subscription mode →
  `pro`, stores customer/subscription ids), `customer.subscription.
updated` (status + period-end sync), `customer.subscription.deleted`
  (→ `free`). Unknown types are recorded and acked — otherwise Stripe
  retries them forever.
- Bad signature or unparseable body → 400 **before any database write**.
- Session creation (Checkout, Customer Portal) is the one place the app
  calls Stripe: server-only module, secret key, price resolved by
  lookup key (`pro_monthly`, created once by a script). Creating a
  session changes nothing about the plan — only the webhook does.
- Entitlement enforcement lives in the DB, like every other rule here:
  a BEFORE INSERT trigger on `clients` caps free orgs (3 active
  clients) and raises P0001 with a message the app forwards verbatim.
  Pro is unlimited. One meter now; future meters copy the pattern.
  Clients were chosen as the meter because they are deterministic (no
  month-rollover logic to get wrong) and are the product's core object.

## Alternatives considered

- **Lazy fetch from the Stripe API at decision time:** latency and
  availability coupled to a third party on every entitlement check;
  no answer for "what plan was this org on during the outage".
  Rejected (and the brief says webhooks).
- **Bidirectional sync (our writes also pushed to Stripe):** two
  writers, conflict resolution, race conditions. The only write we
  need is "cancel", and Stripe already hosts that as the Customer
  Portal. Rejected.
- **Storing full event payloads in `stripe_events`:** nice for audits,
  but payloads are large and the free-tier DB is 500 MB; the Stripe
  dashboard already retains every event. The ledger keeps id + type +
  time. Rejected.
- **Trusting `checkout.session.completed` alone:** breaks on
  cancellation and dunning — the subscription events exist precisely
  to correct the plan afterwards. Rejected.

## Consequences

- Plan changes are eventually consistent: a few hundred ms between
  Stripe accepting a change and the webhook landing. Acceptable —
  downgrades never destroy data (clients archive, invoices are frozen
  records), and the UI always reads the DB copy, never a cached guess.
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` become optional prod
  config: missing them runs the app in a documented "billing disabled"
  mode (upgrade/manage buttons hidden, everything else works) — the
  same honest-disabled pattern as Phase 2 invitations.
- CI proves the whole story without a Stripe account: pgTAP pins the
  DB side (bootstrap row, grant denial, limit trigger, ledger
  idempotency); vitest pins signature verification (bad sig) and
  handler idempotency (duplicate event) with payloads signed by a
  test-only secret.
