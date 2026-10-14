/**
 * Stripe configuration and plan limits. Server-only by construction: none of
 * these are NEXT_PUBLIC_*, so the browser can never read them (check:env
 * enforces that split). Missing keys mean the documented "billing disabled"
 * mode instead of a crash — the same honest-disabled pattern Phase 2 used
 * for email invitations (ADR-0005).
 */

/**
 * Active (non-archived) clients a free org may keep. This constant feeds the
 * usage display only — the authority is the `clients_plan_limit` trigger in
 * migration `20261014100000_subscriptions.sql`, pinned by
 * `100-subscriptions.test.sql`. Change both together.
 */
export const FREE_ACTIVE_CLIENT_LIMIT = 3;

/** Lookup key of the Pro price. Created once by scripts/create-stripe-price.mjs. */
export const PRO_PRICE_LOOKUP_KEY = "pro_monthly";

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}

/** Checkout/Portal buttons render only when a key is actually configured. */
export function isBillingEnabled(): boolean {
  return stripeSecretKey() !== null;
}
