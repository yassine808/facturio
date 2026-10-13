import { z } from "zod";
import type { SupabaseServer } from "@/features/orgs/queries";
import { INVOICE_STATUSES, type InvoiceStatus, isOverdue } from "./types";

/**
 * Invoice queries. RLS scopes every row to the caller's orgs; these helpers
 * shape filters/pagination inside that boundary and Zod-parse the results
 * (the Supabase client is untyped — a schema change in SQL fails loudly
 * here instead of silently typing wrong data).
 */

const statusSchema = z.enum(INVOICE_STATUSES);

const invoiceSummaryRow = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  status: statusSchema,
  currency: z.string(),
  total_minor: z.number(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  clients: z.object({ name: z.string() }).nullable(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummaryRow>;

const invoiceDetailRow = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  status: statusSchema,
  client_id: z.uuid(),
  currency: z.string(),
  subtotal_minor: z.number(),
  tax_rate_bps: z.number(),
  tax_minor: z.number(),
  total_minor: z.number(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  notes: z.string().nullable(),
  sent_at: z.string().nullable(),
  created_at: z.string(),
  clients: z.object({ name: z.string() }).nullable(),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailRow>;

const itemRow = z.object({
  id: z.uuid(),
  position: z.number(),
  description: z.string(),
  quantity: z.number(),
  unit_price_minor: z.number(),
  line_total_minor: z.number(),
});
export type InvoiceItemRow = z.infer<typeof itemRow>;

const paymentRow = z.object({
  id: z.uuid(),
  amount_minor: z.number(),
  paid_at: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type PaymentRow = z.infer<typeof paymentRow>;

export const INVOICES_PAGE_SIZE = 20;

const SUMMARY_COLUMNS =
  "id, number, status, currency, total_minor, issue_date, due_date, clients ( name )";

export async function listInvoices(
  supabase: SupabaseServer,
  opts: { orgId: string; status?: InvoiceStatus; page?: number },
): Promise<InvoiceSummary[]> {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * INVOICES_PAGE_SIZE;
  const to = from + INVOICES_PAGE_SIZE - 1;

  let query = supabase.from("invoices").select(SUMMARY_COLUMNS).eq("org_id", opts.orgId);
  if (opts.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("issue_date", { ascending: false })
    .order("id")
    .range(from, to);
  if (error) throw new Error(`listInvoices: ${error.message}`);
  return z.array(invoiceSummaryRow).parse(data);
}

export async function countInvoices(
  supabase: SupabaseServer,
  opts: { orgId: string; status?: InvoiceStatus },
): Promise<number> {
  let query = supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("org_id", opts.orgId);
  if (opts.status) query = query.eq("status", opts.status);

  const { count, error } = await query;
  if (error) throw new Error(`countInvoices: ${error.message}`);
  return count ?? 0;
}

/** One invoice with its client name: null = not ours / does not exist. */
export async function getInvoice(
  supabase: SupabaseServer,
  orgId: string,
  invoiceId: string,
): Promise<InvoiceDetail | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select(`id, number, status, client_id, currency, subtotal_minor, tax_rate_bps,
              tax_minor, total_minor, issue_date, due_date, notes, sent_at,
              created_at, clients ( name )`)
    .eq("org_id", orgId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new Error(`getInvoice: ${error.message}`);
  return invoiceDetailRow.nullable().parse(data);
}

export async function listInvoiceItems(
  supabase: SupabaseServer,
  orgId: string,
  invoiceId: string,
): Promise<InvoiceItemRow[]> {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("id, position, description, quantity, unit_price_minor, line_total_minor")
    .eq("org_id", orgId)
    .eq("invoice_id", invoiceId)
    .order("position")
    .order("id");
  if (error) throw new Error(`listInvoiceItems: ${error.message}`);
  return z.array(itemRow).parse(data);
}

export async function listPayments(
  supabase: SupabaseServer,
  orgId: string,
  invoiceId: string,
): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount_minor, paid_at, notes, created_at")
    .eq("org_id", orgId)
    .eq("invoice_id", invoiceId)
    .order("paid_at")
    .order("id");
  if (error) throw new Error(`listPayments: ${error.message}`);
  return z.array(paymentRow).parse(data);
}

/** Client options for the invoice header: active (non-archived) only. */
export async function listClientOptions(
  supabase: SupabaseServer,
  orgId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("name");
  if (error) throw new Error(`listClientOptions: ${error.message}`);
  return z.array(z.object({ id: z.uuid(), name: z.string() })).parse(data);
}

/**
 * Dashboard metrics for one org. Summed in JS from RLS-scoped rows rather
 * than a SQL aggregate: totals-per-invoice are already computed by the DB,
 * invoices per org fit comfortably in memory at MVP scale, and this avoids
 * a custom RPC (revoke-whole-surface defense stays intact).
 *
 * Sums are grouped per currency — adding a MAD total to a EUR total would
 * be a fake number, and the org can legitimately invoice in all three.
 */
export type DashboardMetrics = {
  outstandingByCurrency: Record<string, number>;
  overdueByCurrency: Record<string, number>;
  overdueCount: number;
  paidThisMonthByCurrency: Record<string, number>;
  draftCount: number;
};

export async function getDashboardMetrics(
  supabase: SupabaseServer,
  orgId: string,
  today: string,
): Promise<DashboardMetrics> {
  const [sent, drafts, monthPayments] = await Promise.all([
    supabase
      .from("invoices")
      .select("currency, total_minor, due_date")
      .eq("org_id", orgId)
      .eq("status", "sent"),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "draft"),
    supabase
      .from("payments")
      // Payments carry no currency column — the amount is in the invoice's
      // currency, so the sum needs the embed to group correctly.
      .select("amount_minor, paid_at, invoices ( currency )")
      .eq("org_id", orgId)
      .gte("paid_at", today.slice(0, 7) + "-01"), // current month, UTC
  ]);
  if (sent.error) throw new Error(`dashboard(sent): ${sent.error.message}`);
  if (drafts.error) throw new Error(`dashboard(drafts): ${drafts.error.message}`);
  if (monthPayments.error)
    throw new Error(`dashboard(payments): ${monthPayments.error.message}`);

  const invoiceRows = z
    .array(z.object({ currency: z.string(), total_minor: z.number(), due_date: z.string().nullable() }))
    .parse(sent.data);
  const paymentRows = z
    .array(
      z.object({
        amount_minor: z.number(),
        paid_at: z.string(),
        invoices: z.object({ currency: z.string() }),
      }),
    )
    .parse(monthPayments.data);

  const add = (target: Record<string, number>, currency: string, amount: number): void => {
    target[currency] = (target[currency] ?? 0) + amount;
  };

  const outstandingByCurrency: Record<string, number> = {};
  const overdueByCurrency: Record<string, number> = {};
  let overdueCount = 0;
  for (const row of invoiceRows) {
    add(outstandingByCurrency, row.currency, row.total_minor);
    if (isOverdue("sent", row.due_date, today)) {
      add(overdueByCurrency, row.currency, row.total_minor);
      overdueCount += 1;
    }
  }

  const paidThisMonthByCurrency: Record<string, number> = {};
  for (const row of paymentRows) {
    add(paidThisMonthByCurrency, row.invoices.currency, row.amount_minor);
  }

  return {
    outstandingByCurrency,
    overdueByCurrency,
    overdueCount,
    paidThisMonthByCurrency,
    draftCount: drafts.count ?? 0,
  };
}
