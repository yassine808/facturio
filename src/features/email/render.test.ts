import { describe, expect, it } from "vitest";
import { escapeHtml, renderInvoiceEmail } from "./render";

const base = {
  orgName: "Acme Studio",
  invoiceNumber: "INV-2026-0001",
  clientName: "Globex Corp",
  totalFormatted: "1440.00 MAD",
  dueDate: "2026-10-15",
  shareUrl: "https://example.test/share/tok",
};

describe("renderInvoiceEmail", () => {
  it("puts number and issuer in the subject", () => {
    expect(renderInvoiceEmail(base).subject).toBe(
      "Invoice INV-2026-0001 from Acme Studio",
    );
  });

  it("carries amount, due date, and the share URL in both parts", () => {
    const { text, html } = renderInvoiceEmail(base);
    for (const body of [text, html]) {
      expect(body).toContain("1440.00 MAD");
      expect(body).toContain("2026-10-15");
      expect(body).toContain(base.shareUrl);
    }
  });

  it("falls back to a numberless subject for drafts", () => {
    expect(renderInvoiceEmail({ ...base, invoiceNumber: null }).subject).toBe(
      "Invoice from Acme Studio",
    );
  });

  it("drops the due phrase when the invoice has no due date", () => {
    const { text, html } = renderInvoiceEmail({ ...base, dueDate: null });
    expect(text).not.toContain("due 2026-10-15");
    expect(html).not.toContain("due 2026-10-15");
  });

  it("escapes tenant-controlled names in the HTML part (mail-client XSS)", () => {
    const { html, text } = renderInvoiceEmail({
      ...base,
      clientName: `<script>alert("x")</script>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // Plain text stays raw — escaping there would mangle the greeting.
    expect(text).toContain(`<script>alert("x")</script>`);
  });
});

describe("escapeHtml", () => {
  it("covers the five specials", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });
});
