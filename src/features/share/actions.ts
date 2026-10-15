"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SHARE_LINK_DAYS, dbError, mintShareLink, shareRefSchema } from "./link";
import type { FormState } from "@/components/action-form";

/**
 * Share-link actions (ADR-0012): minting shows the raw token exactly
 * once — the server keeps only its hash — and revocation is a one-way
 * update the DB grants column-by-column (revoked_at only). Authority is
 * membership in the org, same as issuing or emailing the invoice; the
 * issued-only rule and the org boundary are DB triggers/policies, whose
 * messages these actions surface verbatim (house pattern from invoices).
 */

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

  const minted = await mintShareLink(supabase, {
    orgId: parsed.data.orgId,
    invoiceId: parsed.data.invoiceId,
    userId: user.id,
  });
  if ("error" in minted) return { ok: false, error: minted.error };

  revalidatePath(`/app/${parsed.data.orgSlug}/invoices/${parsed.data.invoiceId}`);
  // token: the raw value, shown once in the form. The DB never had it.
  return {
    ok: true,
    message: `Share link created — it works for ${SHARE_LINK_DAYS} days or until you revoke it.`,
    token: minted.token,
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
