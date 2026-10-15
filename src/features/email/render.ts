/**
 * The invoice email body (ADR-0008): one subject, one plain-text
 * version, one minimal HTML version — deliberately small and
 * link-first, because the share URL (not the PDF) is what the client
 * opens. Everything interpolated is HTML-escaped: org and client names
 * are tenant-controlled strings and this HTML reaches a mail client.
 */

export type InvoiceEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderInvoiceEmail(input: {
  orgName: string;
  invoiceNumber: string | null;
  clientName: string;
  totalFormatted: string;
  dueDate: string | null;
  shareUrl: string;
}): InvoiceEmailContent {
  const { orgName, invoiceNumber, clientName, totalFormatted, dueDate, shareUrl } =
    input;

  const subject = invoiceNumber
    ? `Invoice ${invoiceNumber} from ${orgName}`
    : `Invoice from ${orgName}`;

  const dueText = dueDate ? `, due ${dueDate}` : "";
  const dueHtml = dueDate ? `, due ${escapeHtml(dueDate)}` : "";
  const text = [
    `Hi ${clientName},`,
    "",
    `${orgName} has sent you an invoice for ${totalFormatted}${dueText}.`,
    "",
    "Open it here — no account needed:",
    shareUrl,
    "",
    "If the link ever stops working, reply to this email and we will reissue it.",
    "",
    `— sent with Facturio`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(clientName)},</p>`,
    `<p><strong>${escapeHtml(orgName)}</strong> has sent you an invoice for ` +
      `<strong>${escapeHtml(totalFormatted)}</strong>${dueHtml}.</p>`,
    `<p><a href="${escapeHtml(shareUrl)}">Open the invoice</a> — no account needed.</p>`,
    `<p style="color:#71717a;font-size:12px">If the link ever stops working, reply to this ` +
      `email and we will reissue it.<br>— sent with Facturio</p>`,
  ].join("\n");

  return { subject, text, html };
}
