import { notFound } from "next/navigation";
import { getSharedInvoice } from "@/features/share/queries";
import { formatMinor } from "@/features/invoices/money";

/**
 * Public, read-only view of ONE issued invoice (ADR-0012). Everything
 * the visitor may see arrives in a single jsonb projection from
 * shared_invoice() — this page never touches tenant tables, so there is
 * no RLS surface to get wrong here. Unknown, expired, and revoked
 * tokens all land on the same 404 (the DB cannot tell them apart, and
 * neither should the URL). Rate limiting happens earlier, in the proxy.
 */
export const dynamic = "force-dynamic";

/** Tokenized URLs must never sit in a search index. */
export const metadata = {
  title: "Shared invoice",
  robots: { index: false, follow: false },
};

export default async function ShareInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const shared = await getSharedInvoice(token);
  if (!shared) notFound();

  const { invoice } = shared;
  const currency = invoice.currency;
  const taxPercent = (invoice.tax_rate_bps / 100).toFixed(2);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {shared.org_name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {invoice.number ?? "Invoice"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {shared.client.name} · issued {invoice.issue_date}
            {invoice.due_date && ` · due ${invoice.due_date}`}
          </p>
        </div>
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          {invoice.status}
        </span>
      </header>

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
            {shared.items.map((item, index) => (
              // Keyed by position: line items carry no id in the public
              // projection (fixed projection — no internals leak).
              <tr key={`${item.description}-${index}`}>
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
                Tax ({taxPercent}%)
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
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Read-only shared invoice from {shared.org_name}. This link can be revoked at any
        time by its issuer.
      </p>
    </main>
  );
}
