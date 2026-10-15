import Stripe from "stripe";
import { log } from "@/lib/logger";
import { stripeWebhookSecret } from "@/features/billing/config";
import {
  processStripeEvent,
  verifyStripeSignature,
  type WebhookWriter,
} from "@/features/billing/webhook";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Stripe webhook endpoint (ADR-0005). The only code path allowed to change
 * `subscriptions`, running with the service-role client (RLS-bypassing,
 * which is exactly why nothing user-facing may import this module's writer).
 *
 * Flow: raw body → signature verification (400 on failure, before any DB
 * write) → declarative sync → ledger insert last → 200. Processing errors
 * return 500 on purpose: Stripe redelivers, and the ledger's primary key
 * makes the retry safe.
 */

export const runtime = "nodejs";

/** Real writer behind the webhook's unit-testable interface. */
function dbWriter(): WebhookWriter {
  const db = createServiceRoleClient();

  /** Runs one update, reports whether a row matched, surfaces DB errors. */
  async function applyAndReport(
    context: string,
    execute: () => PromiseLike<{
      data: { org_id: string }[] | null;
      error: { message: string } | null;
    }>,
  ): Promise<boolean> {
    const { data, error } = await execute();
    if (error) throw new Error(`${context}: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  return {
    // checkout.session.completed — org known from the session metadata.
    attachByOrg: (input) =>
      applyAndReport("attachByOrg", () =>
        db
          .from("subscriptions")
          .update({
            plan: input.plan,
            status: input.status,
            stripe_customer_id: input.stripeCustomerId,
            stripe_subscription_id: input.stripeSubscriptionId,
            current_period_end: input.currentPeriodEnd,
          })
          .eq("org_id", input.orgId)
          .select("org_id"),
      ),

    // customer.subscription.updated — org found via the stored subscription
    // id; 0 rows means the mapping event has not landed yet (out-of-order).
    syncByStripeSubscription: (input) =>
      applyAndReport("syncByStripeSubscription", () =>
        db
          .from("subscriptions")
          .update({
            plan: input.plan,
            status: input.status,
            current_period_end: input.currentPeriodEnd,
          })
          .eq("stripe_subscription_id", input.stripeSubscriptionId)
          .select("org_id"),
      ),

    // customer.subscription.deleted — entitlement ends, subscription id
    // cleared so a future re-subscribe stores its own id cleanly.
    endByStripeSubscription: (input) =>
      applyAndReport("endByStripeSubscription", () =>
        db
          .from("subscriptions")
          .update({
            plan: "free",
            status: input.status,
            stripe_subscription_id: null,
            current_period_end: null,
          })
          .eq("stripe_subscription_id", input.stripeSubscriptionId)
          .select("org_id"),
      ),

    // The ledger — insert, treat the primary key conflict as "already seen".
    recordEvent: async (input) => {
      const { error } = await db.from("stripe_events").insert({
        id: input.id,
        type: input.type,
        stripe_created_at: new Date(input.created * 1000).toISOString(),
      });
      if (!error) return true;
      if (error.code === "23505") return false; // duplicate delivery
      throw new Error(`recordEvent: ${error.message}`);
    },
  };
}

export async function POST(req: Request): Promise<Response> {
  const secret = stripeWebhookSecret();
  if (!secret) return new Response("Stripe is not configured", { status: 503 });

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = verifyStripeSignature(body, signature, secret);
  } catch (error) {
    log("warn", "stripe.webhook_bad_signature", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event, dbWriter());
    log("info", "stripe.webhook", { id: event.id, type: event.type, result });
    return Response.json({ received: true, result });
  } catch (error) {
    log("error", "stripe.webhook_failed", {
      id: event.id,
      type: event.type,
      error: error instanceof Error ? error.message : "unknown",
    });
    return new Response("Webhook processing failed", { status: 500 });
  }
}
