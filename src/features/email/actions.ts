"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { renderInvoicePdf } from "@/features/invoices/invoice-pdf";
import { getInvoice, listInvoiceItems } from "@/features/invoices/queries";
import { formatMinor, type Currency } from "@/features/invoices/money";
import { getOrgBySlug } from "@/features/orgs/queries";
import { mintShareLink } from "@/features/share/link";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { currentEmailConfig } from "./config";
import { renderInvoiceEmail } from "./render";
import { sendInvoiceEmail } from "./send";
import type { FormState } from "@/components/action-form";

/**
 * Email one issued invoice (ADR-0008): resolve the transport, mint a
 * fresh 30-day share link (a stored link's token can never be
 * recovered from its hash — that is the design), render the same PDF
 * the download route serves, attach it, send. The recipient field is
 * editable but validated: the stored client email is a convenience
 * prefill, not an authority.
 */

const emailRefSchema = z.object({
  orgSlug: z.string().min(1).max(100),
  invoiceId: z.uuid(),
  to: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
});

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function firstError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function sendInvoiceByEmail(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  // Checked first and again by send: config can change between render
  // and click; the disabled mode must stay honest either way.
  const config = currentEmailConfig();
  if (config.mode === "disabled") {
    return { ok: false, error: "Email delivery isn't configured on this server." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = emailRefSchema.safeParse({
    orgSlug: str(fd, "orgSlug"),
    invoiceId: str(fd, "invoiceId"),
    to: str(fd, "to"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  // RLS resolves both rows: another org's slug or invoice behaves as
  // if it does not exist (house pattern — orgId is derived, never
  // trusted from the form).
  const org = await getOrgBySlug(supabase, parsed.data.orgSlug);
  if (!org) return { ok: false, error: "Organization not found." };

  const invoice = await getInvoice(supabase, org.id, parsed.data.invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "sent") {
    return {
      ok: false,
      error: "Only issued invoices can be emailed — send the draft first.",
    };
  }

  try {
    const [items, minted] = await Promise.all([
      listInvoiceItems(supabase, org.id, invoice.id),
      mintShareLink(supabase, {
        orgId: org.id,
        invoiceId: invoice.id,
        userId: user.id,
      }),
    ]);
    if ("error" in minted) return { ok: false, error: minted.error };

    const currency = invoice.currency as Currency;
    const shareUrl = `${env().NEXT_PUBLIC_SITE_URL}/share/${minted.token}`;

    const content = renderInvoiceEmail({
      orgName: org.name,
      invoiceNumber: invoice.number,
      clientName: invoice.clients?.name ?? "Client",
      totalFormatted: formatMinor(invoice.total_minor, currency),
      dueDate: invoice.due_date,
      shareUrl,
    });
    const pdf = await renderInvoicePdf({ orgName: org.name, invoice, items });

    const result = await sendInvoiceEmail({
      config,
      to: parsed.data.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      pdf,
      pdfFilename: `Facturio-${invoice.number ?? "draft"}.pdf`,
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath(`/app/${org.slug}/invoices/${invoice.id}`);
    return { ok: true, message: `Invoice emailed to ${parsed.data.to}.` };
  } catch (err) {
    log("error", "email.action_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
