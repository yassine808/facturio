import Stripe from "stripe";

/**
 * The Stripe → Facturio event pipeline (ADR-0005). Deliberately pure: no
 * Supabase, no Next.js, no logging — the route handler wires the real writer
 * in and this module stays unit-testable with a fake writer, which is how CI
 * proves duplicate and out-of-order deliveries behave without an account.
 *
 * Two invariants live here:
 *  1. Every path records `event.id` LAST (Stripe delivers at least once and
 *     does not order events — the ledger's primary key is the dedup).
 *  2. Handlers are declarative syncs of Stripe's own state, so a replay that
 *     slips past the ledger is harmless (idempotent by construction).
 */

/** Fields mirrored from a Stripe subscription into our row. */
export type SubscriptionSync = {
  stripeSubscriptionId: string;
  status: string;
  plan: "free" | "pro";
  currentPeriodEnd: string | null;
};

export type WebhookWriter = {
  /**
   * checkout.session.completed: attach Stripe's ids to the org's row
   * (found by org_id from the session metadata we set at creation).
   * Returns false when the org row no longer exists.
   */
  attachByOrg(
    input: { orgId: string; stripeCustomerId: string | null } & SubscriptionSync,
  ): Promise<boolean>;
  /**
   * customer.subscription.updated: mirror fields on the org that already
   * knows this subscription id. Returns false for an event that arrived
   * BEFORE checkout.session.completed (Stripe guarantees no ordering) —
   * acknowledged, recorded, and skipped; the completed event sets the
   * mapping when it lands.
   */
  syncByStripeSubscription(input: SubscriptionSync): Promise<boolean>;
  /** customer.subscription.deleted: entitlement ends, subscription id cleared. */
  endByStripeSubscription(input: {
    stripeSubscriptionId: string;
    status: string;
  }): Promise<boolean>;
  /**
   * The idempotency ledger, written LAST. Returns false when this event id
   * was already recorded — a duplicate delivery that we still ack with 200.
   */
  recordEvent(input: { id: string; type: string; created: number }): Promise<boolean>;
};

export type ProcessResult = "applied" | "skipped" | "ignored" | "duplicate";

/**
 * Verifies the `stripe-signature` header against the raw body. This is pure
 * HMAC-SHA256 — it never calls the Stripe API — so a placeholder key is safe
 * and keeps webhook verification independent from STRIPE_SECRET_KEY (a
 * deployment can receive webhooks without being able to create sessions).
 */
export function verifyStripeSignature(
  body: string,
  signature: string | null,
  secret: string,
): Stripe.Event {
  if (!signature) throw new Error("missing stripe-signature header");
  const stripe = new Stripe("sk_test_webhook_verify_never_calls_api");
  return stripe.webhooks.constructEvent(body, signature, secret);
}

/**
 * Entitlement from Stripe's lifecycle status. `past_due` keeps access on
 * purpose: dunning retries run for days, and locking an org out mid-run over
 * a failed card helps nobody — Stripe still gets paid or we downgrade when
 * the subscription actually ends.
 */
export function planForStatus(status: string): "free" | "pro" {
  return status === "active" || status === "trialing" || status === "past_due"
    ? "pro"
    : "free";
}

/**
 * Renewal date for the billing page. Stripe's basil API version moved these
 * fields between Subscription and SubscriptionItem — read both shapes
 * instead of betting on which one the installed SDK exposes.
 */
function periodEndOf(sub: Stripe.Subscription): string | null {
  const outer = (sub as unknown as { current_period_end?: number | null })
    .current_period_end;
  const inner = (
    sub.items?.data?.[0] as unknown as { current_period_end?: number | null } | null
  )?.current_period_end;
  const unix = outer ?? inner ?? null;
  return unix === null ? null : new Date(unix * 1000).toISOString();
}

function customerIdOf(session: Stripe.Checkout.Session): string | null {
  if (typeof session.customer === "string") return session.customer;
  return session.customer?.id ?? null;
}

/** Records the event, then reports the outcome (ledger write is always last). */
async function finish(
  event: Stripe.Event,
  writer: WebhookWriter,
  outcome: Exclude<ProcessResult, "duplicate">,
): Promise<ProcessResult> {
  const recorded = await writer.recordEvent({
    id: event.id,
    type: event.type,
    created: event.created,
  });
  return recorded ? outcome : "duplicate";
}

export async function processStripeEvent(
  event: Stripe.Event,
  writer: WebhookWriter,
): Promise<ProcessResult> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return finish(event, writer, "ignored");

      const orgId = session.metadata?.orgId;
      const subscription = session.subscription;
      const subId = typeof subscription === "string" ? subscription : subscription?.id;
      if (!orgId || !subId) {
        // We create both ourselves — retrying cannot fix a malformed session,
        // so failing loudly (500) marks it for inspection instead of hiding it.
        throw new Error(
          `checkout.session.completed without orgId/subscription: ${event.id}`,
        );
      }

      // The session may or may not carry the expanded subscription. When it
      // does not, trust it was created active and let the immediate
      // customer.subscription.updated event correct the status — it always
      // follows checkout.session.completed.
      const sub = typeof subscription === "object" ? subscription : null;
      const status = sub?.status ?? "active";
      const attached = await writer.attachByOrg({
        orgId,
        stripeCustomerId: customerIdOf(session),
        stripeSubscriptionId: subId,
        status,
        plan: planForStatus(status),
        currentPeriodEnd: sub ? periodEndOf(sub) : null,
      });
      return finish(event, writer, attached ? "applied" : "skipped");
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const synced = await writer.syncByStripeSubscription({
        stripeSubscriptionId: sub.id,
        status: sub.status,
        plan: planForStatus(sub.status),
        currentPeriodEnd: periodEndOf(sub),
      });
      return finish(event, writer, synced ? "applied" : "skipped");
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const ended = await writer.endByStripeSubscription({
        stripeSubscriptionId: sub.id,
        status: sub.status,
      });
      return finish(event, writer, ended ? "applied" : "skipped");
    }

    default:
      // Unknown (or not-yet-supported) type: recorded and acked so Stripe
      // stops redelivering it forever (ADR-0005).
      return finish(event, writer, "ignored");
  }
}
