import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  DeletePaymentForm,
  InvoiceTransitionForm,
} from "@/features/invoices/invoice-actions";
import { InvoiceForm } from "@/features/invoices/invoice-form";
import { formatMinor, todayIso, type Currency } from "@/features/invoices/money";
import { PaymentForm } from "@/features/invoices/payment-form";
import {
  getInvoice,
  listClientOptions,
  listInvoiceItems,
  listPayments,
} from "@/features/invoices/queries";
import { isOverdue } from "@/features/invoices/types";
import { updateInvoice } from "@/features/invoices/actions";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * One invoice, in exactly one of four shapes:
 *  - draft:    editable form (header + lines) + send/void
 *  - sent:     read-only record + record-payment + mark-paid/void + removable payments
 *  - paid:     read-only record + frozen payment history
 *  - void:     read-only record
 * The transitions and freezes are DB rules; this page renders around them.
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; invoiceId: string }>;
}) {
  const { orgSlug, invoiceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();
  if (!(await getUserRole(supabase, org.id))) redirect("/app");

  // RLS-scoped: an invoice of another org 404s like a deleted one.
  const invoice = await getInvoice(supabase, org.id, invoiceId);
  if (!invoice) notFound();

  const [items, payments] = await Promise.all([
    listInvoiceItems(supabase, org.id, invoice.id),
    listPayments(supabase, org.id, invoice.id),
  ]);

  const currency = invoice.currency as Currency;
  const draft = invoice.status === "draft";
  const sent = invoice.status === "sent";
  const overdue = isOverdue(invoice.status, invoice.due_date, todayIso());
  const paidTotal = payments.reduce((sum, p) => sum + p.amount_minor, 0);

  // Draft editing needs the client dropdown; an archived (or deleted) client
  // the draft still points at must stay selectable, so prepend it if missing.
  const clientOptions = draft ? await listClientOptions(supabase, org.id) : [];
  if (draft && !clientOptions.some((c) => c.id === invoice.client_id)) {
    clientOptions.unshift({
      id: invoice.client_id,
      name: invoice.clients?.name ?? "Current client",
    });
  }

  const statusBadge: Record<string, string> = {
    draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    paid: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    void: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}/invoices`} className="hover:underline">
          ← Invoices
        </Link>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.number ?? "Draft invoice"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {invoice.clients?.name ?? "Unknown client"} · issued {invoice.issue_date}
            {invoice.due_date && ` · due ${invoice.due_date}`}
            {overdue && (
              <span className="ml-1 font-medium text-red-600 dark:text-red-400">· OVERDUE</span>
            )}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge[invoice.status]}`}
        >
          {invoice.status}
        </span>
      </div>

      {draft ? (
        <>
          <InvoiceForm
            action={updateInvoice}
            orgId={org.id}
            orgSlug={org.slug}
            clients={clientOptions}
            initial={invoice}
            items={items}
            submitLabel="Save draft"
          />
          <div className="flex flex-wrap gap-2">
            <InvoiceTransitionForm
              orgId={org.id}
              orgSlug={org.slug}
              invoiceId={invoice.id}
              to="send"
            />
            <InvoiceTransitionForm
              orgId={org.id}
              orgSlug={org.slug}
              invoiceId={invoice.id}
              to="void"
            />
          </div>
        </>
      ) : (
        <>
          {/* Read-only record: the lines and totals the DB computed. */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2">{item.description}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMinor(item.unit_price_minor, currency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatMinor(item.line_total_minor, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-zinc-200 dark:border-zinc-800">
                <tr>
                  <td colSpan={3} className="px-4 py-1.5 text-right text-zinc-500">
                    Subtotal
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {formatMinor(invoice.subtotal_minor, currency)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-4 py-1.5 text-right text-zinc-500">
                    Tax ({(invoice.tax_rate_bps / 100).toFixed(2)}%)
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {formatMinor(invoice.tax_minor, currency)}
                  </td>
                </tr>
                <tr className="font-medium">
                  <td colSpan={3} className="px-4 py-2 text-right">
                    Total
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMinor(invoice.total_minor, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {invoice.notes && (
              <p className="border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                {invoice.notes}
              </p>
            )}
          </div>

          {sent && (
            <div className="flex flex-wrap gap-2">
              <InvoiceTransitionForm
                orgId={org.id}
                orgSlug={org.slug}
                invoiceId={invoice.id}
                to="paid"
              />
              <InvoiceTransitionForm
                orgId={org.id}
                orgSlug={org.slug}
                invoiceId={invoice.id}
                to="void"
              />
            </div>
          )}

          {(sent || invoice.status === "paid") && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Payments</h2>
              {payments.length > 0 && (
                <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <div>
                        <span className="font-medium tabular-nums">
                          {formatMinor(payment.amount_minor, currency)}
                        </span>
                        <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                          {payment.paid_at}
                          {payment.notes && ` · ${payment.notes}`}
                        </span>
                      </div>
                      {sent && <DeletePaymentForm orgSlug={org.slug} paymentId={payment.id} />}
                    </li>
                  ))}
                  <li className="flex items-center justify-between px-4 py-2.5 text-sm font-medium">
                    <span>Paid so far</span>
                    <span className="tabular-nums">{formatMinor(paidTotal, currency)}</span>
                  </li>
                </ul>
              )}
              {sent ? (
                <PaymentForm
                  orgId={org.id}
                  orgSlug={org.slug}
                  invoiceId={invoice.id}
                  currency={currency}
                />
              ) : (
                payments.length === 0 && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Settled without per-payment records.
                  </p>
                )
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
