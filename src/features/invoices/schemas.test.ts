import { describe, expect, it } from "vitest";
import { invoiceDraftSchema, taxPercentToBps } from "./schemas";

describe("taxPercentToBps", () => {
  it("converts percent strings to basis points with integer math", () => {
    expect(taxPercentToBps("20")).toBe(2000);
    expect(taxPercentToBps("7.5")).toBe(750);
    expect(taxPercentToBps("0")).toBe(0);
    expect(taxPercentToBps("100")).toBe(10000);
  });

  it("rejects garbage and more precision than bps allows", () => {
    expect(taxPercentToBps("abc")).toBeNull();
    expect(taxPercentToBps("20.123")).toBeNull();
    expect(taxPercentToBps("")).toBeNull();
    expect(taxPercentToBps("-5")).toBeNull();
  });
});

describe("invoiceDraftSchema", () => {
  const valid = {
    orgId: "2b0df1b8-0000-4000-8000-000000000001",
    orgSlug: "acme-3f2a",
    invoiceId: null,
    clientId: "2b0df1b8-0000-4000-8000-000000000002",
    currency: "MAD" as const,
    taxRateBps: 2000,
    issueDate: "2026-10-13",
    dueDate: "2026-11-12",
    notes: null,
    lines: [{ itemId: null, description: "Design", quantity: 1, unitPriceMinor: 10000 }],
  };

  it("accepts a valid draft", () => {
    expect(invoiceDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("requires at least one line", () => {
    expect(invoiceDraftSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it("rejects a due date before the issue date", () => {
    expect(invoiceDraftSchema.safeParse({ ...valid, dueDate: "2026-10-12" }).success).toBe(false);
  });

  it("allows a null due date", () => {
    expect(invoiceDraftSchema.safeParse({ ...valid, dueDate: null }).success).toBe(true);
  });

  it("turns empty notes into null, never an empty string", () => {
    expect(invoiceDraftSchema.parse({ ...valid, notes: "  " }).notes).toBeNull();
  });

  it("rejects zero-quantity and negative-price lines", () => {
    expect(
      invoiceDraftSchema.safeParse({
        ...valid,
        lines: [{ itemId: null, description: "X", quantity: 0, unitPriceMinor: 100 }],
      }).success,
    ).toBe(false);
    expect(
      invoiceDraftSchema.safeParse({
        ...valid,
        lines: [{ itemId: null, description: "X", quantity: 1, unitPriceMinor: -1 }],
      }).success,
    ).toBe(false);
  });
});
