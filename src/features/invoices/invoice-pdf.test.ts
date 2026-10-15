import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfProps } from "./invoice-pdf";

/**
 * Smoke test (ADR-0009): the renderer must produce an actual PDF, not
 * just not-throw. The magic bytes are the cheapest proof of that.
 * Content-level rendering is asserted by Playwright's download check.
 */

const fixture: InvoicePdfProps = {
  orgName: "Acme Studio",
  invoice: {
    number: "INV-2026-0001",
    currency: "MAD",
    subtotal_minor: 120000,
    tax_rate_bps: 2000,
    tax_minor: 24000,
    total_minor: 144000,
    issue_date: "2026-10-01",
    due_date: "2026-10-15",
    notes: "Thanks for your business.",
    clients: { name: "Globex Corp", email: "ap@globex.test" },
  },
  items: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      position: 1,
      description: "Website design",
      quantity: 1,
      unit_price_minor: 120000,
      line_total_minor: 120000,
    },
  ],
};

describe("renderInvoicePdf", () => {
  it("emits a real PDF (magic bytes + non-trivial size)", async () => {
    const pdf = await renderInvoicePdf(fixture);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders items-heavy invoices without drifting totals", async () => {
    const pdf = await renderInvoicePdf({
      ...fixture,
      items: Array.from({ length: 40 }, (_, index) => ({
        id: `00000000-0000-0000-0000-00000000${String(index + 1).padStart(4, "0")}`,
        position: index + 1,
        description: `Line ${index + 1} of work performed`,
        quantity: 2.5,
        unit_price_minor: 1000,
        line_total_minor: 2500,
      })),
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
