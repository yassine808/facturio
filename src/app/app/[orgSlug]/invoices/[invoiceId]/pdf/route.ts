import { notFound, redirect } from "next/navigation";
import { renderInvoicePdf } from "@/features/invoices/invoice-pdf";
import { getInvoice, listInvoiceItems } from "@/features/invoices/queries";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * GET the invoice as a PDF (ADR-0009). Authorization is the same three
 * gates as the invoice page — session, org membership, RLS-scoped row —
 * so the cookie the browser sends with the download link is the whole
 * credential. No separate "pdf token": one more secret to leak would be
 * a worse design than reusing the session the page already has.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; invoiceId: string }> },
) {
  const { orgSlug, invoiceId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();
  if (!(await getUserRole(supabase, org.id))) redirect("/app");

  // RLS-scoped: another org's invoice 404s like a deleted one.
  const invoice = await getInvoice(supabase, org.id, invoiceId);
  if (!invoice) notFound();

  const items = await listInvoiceItems(supabase, org.id, invoice.id);

  const pdf = await renderInvoicePdf({
    orgName: org.name,
    invoice,
    items,
  });

  // number is CHECK-constrained to ^INV-[0-9]{4}-[0-9]{4,}$ when present,
  // so the filename cannot smuggle quotes or path characters.
  const filename = `Facturio-${invoice.number ?? "draft"}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
