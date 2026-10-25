import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { CURRENCIES } from "@/features/invoices/money";
import { log } from "@/lib/logger";
import type { SupabaseServer } from "@/features/orgs/queries";

/**
 * Share-link queries. The raw token can never appear here — only its
 * hash is stored (ADR-0012), and the list exists so an invoice page can
 * show and revoke its live links.
 */

const shareLinkRow = z.object({
  id: z.uuid(),
  revoked_at: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
});
export type ShareLink = z.infer<typeof shareLinkRow>;

const shareLinkList = z.array(shareLinkRow);

export async function listShareLinks(
  supabase: SupabaseServer,
  orgId: string,
  invoiceId: string,
): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from("share_links")
    .select("id, revoked_at, expires_at, created_at")
    .eq("org_id", orgId)
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });

  if (error) {
    log("error", "share.list_failed", { code: error.code ?? "", error: error.message });
    return [];
  }

  const parsed = shareLinkList.safeParse(data ?? []);
  if (!parsed.success) {
    log("error", "share.list_shape", { issues: String(parsed.error.issues.length) });
    return [];
  }
  return parsed.data;
}

/** Live = not revoked and not expired (expiry is a timestamp compare). */
export function isLiveLink(link: ShareLink, nowIso: string): boolean {
  return link.revoked_at === null && link.expires_at > nowIso;
}

/**
 * The public read (ADR-0012): the exact projection the DB function
 * returns, Zod-checked so a schema drift 404s instead of rendering
 * garbage. Zod also re-enforces the currency set — defense the DB
 * already has, but this page renders money from untyped jsonb.
 */
const sharedInvoiceProjection = z.object({
  org_name: z.string(),
  invoice: z.object({
    number: z.string().nullable(),
    status: z.string(),
    currency: z.enum(CURRENCIES),
    issue_date: z.string(),
    due_date: z.string().nullable(),
    subtotal_minor: z.number(),
    tax_rate_bps: z.number(),
    tax_minor: z.number(),
    total_minor: z.number(),
  }),
  client: z.object({ name: z.string() }),
  items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unit_price_minor: z.number(),
      line_total_minor: z.number(),
    }),
  ),
});
export type SharedInvoice = z.infer<typeof sharedInvoiceProjection>;

/**
 * Resolves a share token as ANON, on purpose: shared_invoice() is
 * granted to anon only (one auditable public door), so reusing the
 * session cookie would lock out logged-in members clicking their own
 * share URL. Cookieless client = every visitor — member, client,
 * stranger — reads through the identical anonymous path. Wrong,
 * expired, and revoked tokens come back null from the DB itself; an
 * RPC error is logged and also null (fail closed, no oracle).
 */
export async function getSharedInvoice(token: string): Promise<SharedInvoice | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );

  const { data, error } = await supabase.rpc("shared_invoice", { p_token: token });
  if (error) {
    log("error", "share.rpc_failed", { code: error.code ?? "", error: error.message });
    return null;
  }
  if (data === null || data === undefined) return null;

  const parsed = sharedInvoiceProjection.safeParse(data);
  if (!parsed.success) {
    log("error", "share.projection_shape", {
      issues: String(parsed.error.issues.length),
    });
    return null;
  }
  return parsed.data;
}
