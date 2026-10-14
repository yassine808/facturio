import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMinor, todayIso, type Currency } from "@/features/invoices/money";
import { getDashboardMetrics } from "@/features/invoices/queries";
import { listInvoices } from "@/features/invoices/queries";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Per-organization dashboard: the numbers an owner checks first (what is
 * owed, what is late, what came in this month) plus the two working links
 * (clients, invoices). All figures come from RLS-scoped rows summed in JS
 * — no aggregate RPC, so the revoke-the-surface defense stays intact.
 */
export default async function OrgHomePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();

  // Visible to members only, so a null role means something changed under us
  // (org deleted, membership removed mid-request) — fail closed.
  const role = await getUserRole(supabase, org.id);
  if (!role) notFound();

  const today = todayIso();
  const [metrics, recent] = await Promise.all([
    getDashboardMetrics(supabase, org.id, today),
    listInvoices(supabase, { orgId: org.id }),
  ]);

  // Multi-currency orgs get one figure per currency — never a fake sum of
  // mixed currencies. Falls back to a zero MAD line when nothing exists yet.
  const grouped = (byCurrency: Record<string, number>): string => {
    const entries = Object.entries(byCurrency).filter(([, amount]) => amount !== 0);
    if (entries.length === 0) return formatMinor(0, "MAD");
    return entries
      .map(([code, amount]) => formatMinor(amount, code as Currency))
      .join(" · ");
  };

  const cards = [
    {
      label: "Outstanding",
      value: grouped(metrics.outstandingByCurrency),
      hint: `${metrics.overdueCount} overdue`,
      tone: metrics.overdueCount > 0 ? "text-red-600 dark:text-red-400" : undefined,
    },
    {
      label: "Overdue",
      value: grouped(metrics.overdueByCurrency),
      hint: "sent past their due date",
      tone: metrics.overdueCount > 0 ? "text-red-600 dark:text-red-400" : undefined,
    },
    {
      label: "Paid this month",
      value: grouped(metrics.paidThisMonthByCurrency),
      hint: "recorded payments",
    },
    {
      label: "Drafts",
      value: String(metrics.draftCount),
      hint: "waiting to be sent",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Signed in as {role} · <span className="font-mono">/{org.slug}</span>
        </p>
      </div>

      {/* Each card formats one figure per currency — see `grouped`. */}
      <dl className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
          >
            <dt className="text-xs uppercase tracking-wide text-zinc-500">
              {card.label}
            </dt>
            <dd
              className={`mt-1 text-lg font-semibold tabular-nums ${card.tone ?? ""}`}
            >
              {card.value}
            </dd>
            <dd className="text-xs text-zinc-500 dark:text-zinc-400">{card.hint}</dd>
          </div>
        ))}
      </dl>

      {recent.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent invoices</h2>
            <Link
              href={`/app/${org.slug}/invoices`}
              className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              View all →
            </Link>
          </div>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {recent.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/app/${org.slug}/invoices/${invoice.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 truncate">
                    {invoice.number ?? "Draft"}
                    <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                      {invoice.clients?.name}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatMinor(invoice.total_minor, invoice.currency as Currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/app/${org.slug}/invoices/new`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          New invoice
        </Link>
        <Link
          href={`/app/${org.slug}/clients`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Clients
        </Link>
        <Link
          href={`/app/${org.slug}/settings/members`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Manage members
        </Link>
        <Link
          href={`/app/${org.slug}/settings/billing`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Billing
        </Link>
        <Link
          href="/app/new"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          New organization
        </Link>
      </div>
    </div>
  );
}
