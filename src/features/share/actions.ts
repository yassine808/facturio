"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { log } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { generateShareToken, hashShareToken } from "./token";
import type { FormState } from "@/components/action-form";

/**
 * Share-link actions (ADR-0012): minting shows the raw token exactly
 * once — the server keeps only its hash — and revocation is a one-way
 * update the DB grants column-by-column (revoked_at only). Authority is
 * membership in the org, same as issuing or emailing the invoice; the
 * issued-only rule and the org boundary are DB triggers/policies, which
 * these messages surface verbatim (house pattern from invoices).
 */

export const SHARE_LINK_DAYS = 30;

const shareRefSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().min(1).max(100),
  invoiceId: z.uuid(),
});

const revokeRefSchema = shareRefSchema.extend({
  linkId: z.uuid(),
});

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function firstError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/** P0001 messages come straight from the triggers, written for humans. */
function dbError(
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

export async function createShareLink(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = shareRefSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    invoiceId: str(fd, "invoiceId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const token = generateShareToken();
  const tokenHash = await hashShareToken(token);
  const expiresAt = new Date(
    Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await supabase.from("share_links").insert({
    org_id: parsed.data.orgId,
    invoice_id: parsed.data.invoiceId,
    token_hash: tokenHash,
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (error) return dbError("share.create_failed", error);

  revalidatePath(`/app/${parsed.data.orgSlug}/invoices/${parsed.data.invoiceId}`);
  // token: the raw value, shown once in the form. The DB never had it.
  return {
    ok: true,
    message: `Share link created — it works for ${SHARE_LINK_DAYS} days or until you revoke it.`,
    token,
  };
}

export async function revokeShareLink(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = revokeRefSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    invoiceId: str(fd, "invoiceId"),
    linkId: str(fd, "linkId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data, error } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", parsed.data.orgId)
    .eq("id", parsed.data.linkId)
    .select("id");
  if (error) return dbError("share.revoke_failed", error);
  if (!data || data.length === 0) return { ok: false, error: "Share link not found." };

  revalidatePath(`/app/${parsed.data.orgSlug}/invoices/${parsed.data.invoiceId}`);
  return {
    ok: true,
    message: "Share link revoked — the URL stops working immediately.",
  };
}
