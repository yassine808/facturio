import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "./types";

/**
 * Query helpers for the orgs feature. The Supabase client here is untyped
 * (we do not commit generated Database types), so every select is parsed
 * with Zod at this boundary — a schema change in SQL fails loudly at runtime
 * instead of silently typing wrong data.
 *
 * All of these run under the caller's session: RLS already limits rows to
 * what the user may see, which is exactly why getOrgBySlug returns null for
 * an org the caller is not a member of (the page turns that into a 404).
 */
export type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

const orgRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});
export type OrgRow = z.infer<typeof orgRow>;

const roleRow = z.enum(["owner", "admin", "member"]);

const memberRow = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  role: roleRow,
  profiles: z.object({ display_name: z.string().nullable() }).nullable(),
});
export type MemberRow = z.infer<typeof memberRow>;

const invitationRow = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(["member", "admin"]),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
});
export type InvitationRow = z.infer<typeof invitationRow>;

/** Every organization the caller belongs to, oldest first (stable switcher). */
export async function listOrgsForUser(supabase: SupabaseServer): Promise<OrgRow[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .order("created_at");
  if (error) throw new Error(`listOrgsForUser: ${error.message}`);
  return z.array(orgRow).parse(data);
}

/** Resolves by slug under RLS: null means "does not exist OR not yours". */
export async function getOrgBySlug(
  supabase: SupabaseServer,
  slug: string,
): Promise<OrgRow | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getOrgBySlug: ${error.message}`);
  return orgRow.nullable().parse(data);
}

/** The caller's role in an org, via the RLS helper RPC (ADR-0004). */
export async function getUserRole(
  supabase: SupabaseServer,
  orgId: string,
): Promise<OrgRole | null> {
  const { data, error } = await supabase.rpc("org_role", { p_org_id: orgId });
  if (error) throw new Error(`getUserRole: ${error.message}`);
  return roleRow.nullable().parse(data);
}

/** Members of an org with their display names (co-members see profiles). */
export async function listMembers(
  supabase: SupabaseServer,
  orgId: string,
): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, role, profiles ( display_name )")
    .eq("org_id", orgId)
    .order("created_at");
  if (error) throw new Error(`listMembers: ${error.message}`);
  return z.array(memberRow).parse(data);
}

/**
 * Invitations of an org. RLS already restricts this to owner/admin, so a
 * member's page simply gets an empty list and never renders this section.
 */
export async function listInvitations(
  supabase: SupabaseServer,
  orgId: string,
): Promise<InvitationRow[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role, expires_at, accepted_at")
    .eq("org_id", orgId)
    .order("created_at");
  if (error) throw new Error(`listInvitations: ${error.message}`);
  return z.array(invitationRow).parse(data);
}
