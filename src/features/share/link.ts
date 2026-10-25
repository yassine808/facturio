import { z } from "zod";
import { log } from "@/lib/logger";
import type { SupabaseServer } from "@/features/orgs/queries";
import { generateShareToken, hashShareToken } from "./token";
import type { FormState } from "@/components/action-form";

/**
 * Share-link DB work shared by the mint action and the email action
 * (ADR-0012). Lives outside "use server" on purpose: Next.js turns
 * every export of an action module into an HTTP endpoint, and a helper
 * that takes a supabase client is not an endpoint.
 */

export const SHARE_LINK_DAYS = 30;

/** P0001/23514 messages come straight from the triggers, for humans. */
export function dbError(
  context: string,
  error: { code?: string | null; message: string },
): FormState {
  log("error", context, { code: error.code ?? "", error: error.message });
  switch (error.code) {
    case "P0001":
    case "23514":
      return { ok: false, error: error.message };
    case "42501":
      return { ok: false, error: "You do not have permission to do that." };
    case "23503":
      return { ok: false, error: "That record does not exist in this organization." };
    default:
      return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export type MintResult = { token: string } | { error: string };

/**
 * Mints one 30-day link and returns the RAW token — the only moment it
 * exists on the server. Emailing needs it because a stored link's
 * token can never be recovered from its hash (that is the whole
 * design), so every delivery mints its own link, individually
 * revocable on the invoice page.
 */
export async function mintShareLink(
  supabase: SupabaseServer,
  args: { orgId: string; invoiceId: string; userId: string },
): Promise<MintResult> {
  const token = generateShareToken();
  const tokenHash = await hashShareToken(token);
  const expiresAt = new Date(
    Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await supabase.from("share_links").insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    token_hash: tokenHash,
    created_by: args.userId,
    expires_at: expiresAt,
  });
  if (error)
    return { error: dbError("share.create_failed", error).error ?? "Minting failed." };

  return { token };
}

/** Validated ref used by both share actions (form fields, not query args). */
export const shareRefSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().min(1).max(100),
  invoiceId: z.uuid(),
});
