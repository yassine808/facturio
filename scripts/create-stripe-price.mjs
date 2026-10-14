#!/usr/bin/env node
/**
 * Creates (or reuses) the Facturio Pro product + recurring price in the
 * Stripe account pointed at by STRIPE_SECRET_KEY. Run ONCE per Stripe
 * account, after copying .env.example → .env.local:
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/create-stripe-price.mjs [currency] [amount]
 *
 * Defaults: eur, 900 (i.e. €9.00/month). The price gets the lookup key
 * `pro_monthly`, which is what the checkout action resolves at runtime —
 * no price id needs to be configured anywhere.
 */
import Stripe from "stripe";

const currency = (process.argv[2] ?? "eur").toLowerCase();
const amount = Number(process.argv[3] ?? 900);

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is not set (Stripe dashboard → Developers → API keys).",
  );
  process.exit(1);
}
if (!Number.isInteger(amount) || amount <= 0) {
  console.error(
    `Amount must be a positive integer in minor units, got: ${process.argv[3]}`,
  );
  process.exit(1);
}

const stripe = new Stripe(key);

const existing = await stripe.prices.list({
  lookup_keys: ["pro_monthly"],
  active: true,
  limit: 1,
});
if (existing.data[0]) {
  console.log(
    `Pro price already exists: ${existing.data[0].id} (lookup key pro_monthly)`,
  );
  process.exit(0);
}

const product = await stripe.products.create({ name: "Facturio Pro" });
const price = await stripe.prices.create({
  unit_amount: amount,
  currency,
  recurring: { interval: "month" },
  product: product.id,
  lookup_key: "pro_monthly",
  nickname: "Facturio Pro monthly",
});

console.log(
  `Created Pro price: ${price.id} (${(amount / 100).toFixed(2)} ${currency}/month)`,
);
console.log("Done — set STRIPE_WEBHOOK_SECRET from the endpoint you create next:");
console.log(
  "  Dashboard → Developers → Webhooks → add http://localhost:3000/api/webhooks/stripe",
);
console.log(
  "  (local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`)",
);
