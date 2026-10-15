import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  planForStatus,
  processStripeEvent,
  verifyStripeSignature,
  type WebhookWriter,
} from "./webhook";

const SECRET = "whsec_unit_test_only";

/**
 * Stripe's signature scheme, computed by hand instead of an SDK helper so the
 * test documents what is actually verified: HMAC-SHA256(secret,
 * `${timestamp}.${payload}`), compared against every v1= entry in the header.
 */
function sign(
  payload: string,
  secret = SECRET,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** Records the call sequence so tests can assert order and duplicates. */
function makeWriter(overrides: Partial<WebhookWriter> = {}): {
  writer: WebhookWriter;
  calls: string[];
} {
  const calls: string[] = [];
  const writer: WebhookWriter = {
    attachByOrg: async (input) => {
      calls.push(`attach:${input.plan}`);
      return true;
    },
    syncByStripeSubscription: async () => {
      calls.push("sync");
      return true;
    },
    endByStripeSubscription: async () => {
      calls.push("end");
      return true;
    },
    recordEvent: async () => {
      calls.push("record");
      return true;
    },
    ...overrides,
  };
  return { writer, calls };
}

const checkoutEvent = {
  id: "evt_checkout_1",
  object: "event",
  type: "checkout.session.completed",
  created: 1_700_000_000,
  data: {
    object: {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "subscription",
      customer: "cus_1",
      subscription: "sub_1",
      metadata: { orgId: "org_1" },
    },
  },
} as unknown as Stripe.Event;

const updatedEvent = {
  id: "evt_sub_updated",
  object: "event",
  type: "customer.subscription.updated",
  created: 1_700_000_100,
  data: {
    object: {
      id: "sub_1",
      object: "subscription",
      status: "active",
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    },
  },
} as unknown as Stripe.Event;

const deletedEvent = {
  id: "evt_sub_deleted",
  object: "event",
  type: "customer.subscription.deleted",
  created: 1_700_000_200,
  data: { object: { id: "sub_1", object: "subscription", status: "canceled" } },
} as unknown as Stripe.Event;

const unknownEvent = {
  id: "evt_inv_paid",
  object: "event",
  type: "invoice.paid",
  created: 1_700_000_300,
  data: { object: { id: "in_1", object: "invoice" } },
} as unknown as Stripe.Event;

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed body", () => {
    const payload = JSON.stringify(checkoutEvent);
    const event = verifyStripeSignature(payload, sign(payload), SECRET);
    expect(event.id).toBe("evt_checkout_1");
  });

  it("rejects a wrong secret", () => {
    const payload = JSON.stringify(checkoutEvent);
    expect(() =>
      verifyStripeSignature(payload, sign(payload, "whsec_wrong_secret_abc"), SECRET),
    ).toThrow();
  });

  it("rejects a tampered body (signed payload ≠ delivered payload)", () => {
    const payload = JSON.stringify(checkoutEvent);
    const signature = sign(payload);
    const tampered = payload.replace("evt_checkout_1", "evt_forged_1");
    expect(() => verifyStripeSignature(tampered, signature, SECRET)).toThrow();
  });

  it("rejects a missing signature header", () => {
    expect(() => verifyStripeSignature("{}", null, SECRET)).toThrow(/stripe-signature/);
  });
});

describe("processStripeEvent", () => {
  it("checkout completed: attaches the org as pro and records the event LAST", async () => {
    const { writer, calls } = makeWriter();
    const result = await processStripeEvent(checkoutEvent, writer);
    expect(result).toBe("applied");
    expect(calls).toEqual(["attach:pro", "record"]);
  });

  it("acknowledges a duplicate delivery (ledger says seen) without re-applying harm", async () => {
    const { writer, calls } = makeWriter({
      recordEvent: async () => {
        calls.push("record");
        return false;
      },
    });
    const result = await processStripeEvent(checkoutEvent, writer);
    expect(result).toBe("duplicate");
    expect(calls).toEqual(["attach:pro", "record"]);
  });

  it("survives out-of-order delivery: updated before the org mapping exists", async () => {
    const { writer, calls } = makeWriter({
      syncByStripeSubscription: async () => {
        calls.push("sync");
        return false; // no org row knows sub_1 yet
      },
    });
    const result = await processStripeEvent(updatedEvent, writer);
    expect(result).toBe("skipped");
    expect(calls).toEqual(["sync", "record"]);
  });

  it("subscription updated: mirrors status and plan, records last", async () => {
    const { writer, calls } = makeWriter();
    const result = await processStripeEvent(updatedEvent, writer);
    expect(result).toBe("applied");
    expect(calls).toEqual(["sync", "record"]);
  });

  it("subscription deleted: ends the entitlement", async () => {
    const { writer, calls } = makeWriter();
    const result = await processStripeEvent(deletedEvent, writer);
    expect(result).toBe("applied");
    expect(calls).toEqual(["end", "record"]);
  });

  it("unknown event types are recorded and acked, never applied", async () => {
    const { writer, calls } = makeWriter();
    const result = await processStripeEvent(unknownEvent, writer);
    expect(result).toBe("ignored");
    expect(calls).toEqual(["record"]);
  });

  it("checkout without metadata fails loudly (retrying cannot fix it)", async () => {
    const { writer } = makeWriter();
    const malformed = {
      ...checkoutEvent,
      data: {
        object: {
          id: "cs_test_2",
          object: "checkout.session",
          mode: "subscription",
          customer: "cus_1",
          subscription: "sub_2",
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    await expect(processStripeEvent(malformed, writer)).rejects.toThrow(/orgId/);
  });
});

describe("planForStatus", () => {
  it.each([
    ["active", "pro"],
    ["trialing", "pro"],
    ["past_due", "pro"], // dunning keeps access on purpose
    ["canceled", "free"],
    ["incomplete", "free"],
    ["unpaid", "free"],
  ])("%s → %s", (status, plan) => {
    expect(planForStatus(status)).toBe(plan);
  });
});
