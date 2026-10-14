"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import Stripe from "stripe";
import { log } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseServer } from "@/features/orgs/queries";
import type { FormState } from "@/components/action-form";
import { PRO_PRICE_LOOKUP_KEY, stripeSecretKey } from "./config";
import { getSubscription } from "./queries";

/**
 * Checkout and Customer Portal entry points (ADR-0005). These are the ONLY
 * places the app talks to Stripe, and creating a session never mutates the
 * plan — the webhook is the only writer of `subscriptions`. Both actions are
 * owner/admin gated: billing is settings, not working data.
 */

const billingRefSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  orgSlug: z.string().min(1).max(100),
});

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** Role check via the RLS helper RPC (ADR-0004). Fails closed. */
async function canManageBilling(
  supabase: SupabaseServer,
  orgId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_org_role", {
    p_org_id: orgId,
    p_roles: ["owner", "admin"],
  });
  if (error) {
    log("error", "billing.has_role_failed", { orgId, error: error.message });
    return false;
  }
  return data === true;
}

export async function startCheckout(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = billingRefSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid organization" };
  const { orgId, orgSlug } = parsed.data;

  if (!(await canManageBilling(supabase, orgId))) {
    return { ok: false, error: "Only owners and admins can manage billing" };
  }

  const key = stripeSecretKey();
  if (!key)
    return { ok: false, error: "Billing is not configured on this deployment." };
  const stripe = new Stripe(key);

  let checkoutUrl: string;
  try {
    const subscription = await getSubscription(supabase, orgId);
    if (subscription?.plan === "pro") {
      return { ok: false, error: "This organization is already on Pro." };
    }

    const prices = await stripe.prices.list({
      lookup_keys: [PRO_PRICE_LOOKUP_KEY],
      active: true,
      limit: 1,
    });
    const price = prices.data[0];
    if (!price) {
      return {
        ok: false,
        error:
          "The Pro price is missing in Stripe — run scripts/create-stripe-price.mjs first.",
      };
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL!;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(subscription?.stripeCustomerId
        ? { customer: subscription.stripeCustomerId }
        : { customer_email: user.email ?? undefined }),
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${site}/app/${orgSlug}/settings/billing?checkout=success`,
      cancel_url: `${site}/app/${orgSlug}/settings/billing?checkout=cancelled`,
      // The webhook finds the org through this metadata (ADR-0005).
      metadata: { orgId },
      subscription_data: { metadata: { orgId } },
    });
    if (!session.url)
      return { ok: false, error: "Stripe did not return a checkout URL." };
    checkoutUrl = session.url;
    log("info", "billing.checkout_created", { orgId, sessionId: session.id });
  } catch (error) {
    log("error", "billing.checkout_failed", {
      orgId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: "Could not reach Stripe. Try again." };
  }

  redirect(checkoutUrl);
}

export async function openPortal(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = billingRefSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid organization" };
  const { orgId, orgSlug } = parsed.data;

  if (!(await canManageBilling(supabase, orgId))) {
    return { ok: false, error: "Only owners and admins can manage billing" };
  }

  const key = stripeSecretKey();
  if (!key)
    return { ok: false, error: "Billing is not configured on this deployment." };
  const stripe = new Stripe(key);

  let portalUrl: string;
  try {
    const subscription = await getSubscription(supabase, orgId);
    if (!subscription?.stripeCustomerId) {
      return { ok: false, error: "No billing account yet — upgrade to Pro first." };
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/app/${orgSlug}/settings/billing`,
    });
    portalUrl = session.url;
    log("info", "billing.portal_opened", { orgId, sessionId: session.id });
  } catch (error) {
    log("error", "billing.portal_failed", {
      orgId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: "Could not reach Stripe. Try again." };
  }

  redirect(portalUrl);
}
