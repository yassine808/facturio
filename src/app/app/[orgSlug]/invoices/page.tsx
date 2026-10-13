import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { button } from "@/features/auth/form-styles";
import { formatMinor, todayIso, type Currency } from "@/features/invoices/money";
import {
  INVOICES_PAGE_SIZE,
  countInvoices,
  listInvoices,
} from "@/features/invoices/queries";
import { INVOICE_STATUSES, isOverdue, type InvoiceStatus } from "@/features/invoices/types";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Invoice list: one tab per status (overdue is derived, shown as a badge
 * on sent rows, never a separate stored state).
 */

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
};

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  void: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { orgSlug } = await params;
  const { status: statusRaw, page: pageRaw = "1" } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();
  if (!(await getUserRole(supabase, org.id))) redirect("/app");

  const status = INVOICE_STATUSES.find((s) => s === statusRaw);
  const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);

  const [invoices, total] = await Promise.all([
    listInvoices(supabase, { orgId: org.id, status, page }),
    countInvoices(supabase, { orgId: org.id, status }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / INVOICES_PAGE_SIZE));
  const today = todayIso();

  const pageHref = (nextPage: number): string => {
    const search = new URLSearchParams();
    if (status) search.set("status", status);
    if (nextPage > 1) search.set("page", String(nextPage));
    const qs = search.toString();
    return `/app/${org.slug}/invoices${qs ? `?${qs}` : ""}`;
  };

  const tabs: { label: string; href: string; active: boolean }[] = [
    { label: "All", href: `/app/${org.slug}/invoices`, active: !status },
    ...INVOICE_STATUSES.map((s) => ({
      label: STATUS_LABELS[s],
      href: `/app/${org.slug}/invoices?status=${s}`,
      active: status === s,
    })),
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}`} className="hover:underline">
          ← {org.name}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {total} {total === 1 ? "invoice" : "invoices"}
            {status ? ` · ${STATUS_LABELS[status].toLowerCase()}` : ""}
          </p>
        </div>
        <Link href={`/app/${org.slug}/invoices/new`} className={`${button} !w-auto`}>
          New invoice
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1 text-sm">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            className={
              tab.active
                ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                : "rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {invoices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {status
            ? `No ${STATUS_LABELS[status].toLowerCase()} invoices.`
            : "No invoices yet — create the first one."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {invoices.map((invoice) => {
            const overdue = isOverdue(invoice.status, invoice.due_date, today);
            return (
              <li key={invoice.id}>
                <Link
                  href={`/app/${org.slug}/invoices/${invoice.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {invoice.number ?? "Draft"}
                      <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                        {invoice.clients?.name ?? "Unknown client"}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Issued {invoice.issue_date}
                      {invoice.due_date && ` · Due ${invoice.due_date}`}
                      {overdue && (
                        <span className="ml-1 font-medium text-red-600 dark:text-red-400">
                          · OVERDUE
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">
                      {formatMinor(invoice.total_minor, invoice.currency as Currency)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[invoice.status]}`}
                    >
                      {STATUS_LABELS[invoice.status]}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500 dark:text-zinc-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
