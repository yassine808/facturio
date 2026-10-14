import { z } from "zod";
import type { SupabaseServer } from "@/features/orgs/queries";

/**
 * Read side of the billing model (ADR-0005): the local copy of Stripe state,
 * reachable through RLS like everything else. Zod parses at this boundary —
 * the webhook writes the raw shapes, the pages consume these.
 */

const subscriptionRow = z.object({
  plan: z.enum(["free", "pro"]),
  status: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
});

export type SubscriptionRow = z.infer<typeof subscriptionRow>;

/** The org's subscription row. Null only if the bootstrap trigger failed. */
export async function getSubscription(
  supabase: SupabaseServer,
  orgId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "plan, status, stripe_customer_id, stripe_subscription_id, current_period_end",
    )
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`getSubscription: ${error.message}`);
  if (!data) return null;

  return subscriptionRow.parse({
    plan: data.plan,
    status: data.status,
    stripeCustomerId: data.stripe_customer_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    currentPeriodEnd: data.current_period_end,
  });
}

/** Active (non-archived) clients — the free-plan meter, display side. */
export async function getActiveClientCount(
  supabase: SupabaseServer,
  orgId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("archived_at", null);
  if (error) throw new Error(`getActiveClientCount: ${error.message}`);
  return count ?? 0;
}
