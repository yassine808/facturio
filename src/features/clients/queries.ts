import { z } from "zod";
import type { SupabaseServer } from "@/features/orgs/queries";

/**
 * Client list queries. Same contract as the orgs feature: untyped Supabase
 * client, every select Zod-parsed, RLS does the actual row scoping — these
 * helpers only shape what the caller asked for within that boundary.
 */

export const clientRow = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  archived_at: z.string().nullable(),
});
export type ClientRow = z.infer<typeof clientRow>;

export const CLIENTS_PAGE_SIZE = 20;

/**
 * `%`/`_`/`\` are LIKE metacharacters; a user typing "100%" should search
 * for "100%", not silently widen the match to everything starting with 100.
 */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listClients(
  supabase: SupabaseServer,
  opts: {
    orgId: string;
    search?: string;
    includeArchived?: boolean;
    page?: number;
  },
): Promise<ClientRow[]> {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * CLIENTS_PAGE_SIZE;
  const to = from + CLIENTS_PAGE_SIZE - 1;

  let query = supabase
    .from("clients")
    .select("id, name, email, address, archived_at")
    .eq("org_id", opts.orgId);
  if (!opts.includeArchived) query = query.is("archived_at", null);
  if (opts.search) query = query.ilike("name", `%${likeEscape(opts.search)}%`);

  const { data, error } = await query
    .order("name")
    .order("id")
    .range(from, to);
  if (error) throw new Error(`listClients: ${error.message}`);
  return z.array(clientRow).parse(data);
}

/** Total matching rows (filtered the same way), for pagination. */
export async function countClients(
  supabase: SupabaseServer,
  opts: { orgId: string; search?: string; includeArchived?: boolean },
): Promise<number> {
  let query = supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("org_id", opts.orgId);
  if (!opts.includeArchived) query = query.is("archived_at", null);
  if (opts.search) query = query.ilike("name", `%${likeEscape(opts.search)}%`);

  const { count, error } = await query;
  if (error) throw new Error(`countClients: ${error.message}`);
  return count ?? 0;
}

/** One client by id under RLS: null means "not yours / does not exist". */
export async function getClient(
  supabase: SupabaseServer,
  orgId: string,
  clientId: string,
): Promise<ClientRow | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, address, archived_at")
    .eq("org_id", orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  return clientRow.nullable().parse(data);
}
