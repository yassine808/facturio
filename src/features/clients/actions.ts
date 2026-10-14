"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { clientRefSchema, clientSchema } from "./schemas";
import type { FormState } from "./types";

/**
 * Client actions. The database is the boundary (RLS with-check on org_id,
 * no delete at all); these turn silent 0-row results into real messages and
 * revalidate the right pages. Members may manage clients — they are working
 * data, not settings (role gating lives on org settings pages).
 */

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function firstError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/**
 * Logs the raw error, returns a message safe (and useful) to show. P0001
 * messages come straight from the triggers — including the Phase 4 plan-limit
 * trigger ("free plan includes 3 active clients …") — because they are
 * written for humans and must not be re-worded on the way out.
 */
function dbError(
  context: string,
  error: { code?: string | null; message: string },
): FormState {
  log("error", context, { code: error.code ?? "", error: error.message });
  if (error.code === "P0001") return { ok: false, error: error.message };
  if (error.code === "42501")
    return { ok: false, error: "You do not have permission to do that." };
  return { ok: false, error: "Could not save the client. Try again." };
}

function revalidateClients(): void {
  // One layout-level revalidation covers the list, the new/edit pages, and
  // the dashboard (counts change with clients). Cheap and hard to get wrong.
  revalidatePath("/app", "layout");
}

export async function createClient(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = clientSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    name: str(fd, "name"),
    email: str(fd, "email"),
    address: str(fd, "address"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await supabase.from("clients").insert({
    org_id: parsed.data.orgId,
    name: parsed.data.name,
    email: parsed.data.email,
    address: parsed.data.address,
  });
  if (error) return dbError("clients.create_failed", error);

  revalidateClients();
  redirect(`/app/${parsed.data.orgSlug}/clients`);
}

export async function updateClient(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const full = clientSchema.extend({ clientId: z.uuid("Invalid client") }).safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    clientId: str(fd, "clientId"),
    name: str(fd, "name"),
    email: str(fd, "email"),
    address: str(fd, "address"),
  });
  if (!full.success) return { ok: false, error: firstError(full.error) };

  const { data, error } = await supabase
    .from("clients")
    .update({
      name: full.data.name,
      email: full.data.email,
      address: full.data.address,
    })
    .eq("id", full.data.clientId)
    .select("id");
  if (error) return dbError("clients.update_failed", error);
  if (!data || data.length === 0) {
    // RLS filtered the row away: either not ours or gone. Same message —
    // a foreign id must not confirm existence.
    return { ok: false, error: "Client not found." };
  }

  revalidateClients();
  return { ok: true, message: "Client saved." };
}

export async function archiveClient(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return setArchived(fd, true);
}

export async function restoreClient(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return setArchived(fd, false);
}

async function setArchived(fd: FormData, archived: boolean): Promise<FormState> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = clientRefSchema.safeParse({
    orgSlug: str(fd, "orgSlug"),
    clientId: str(fd, "clientId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data, error } = await supabase
    .from("clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", parsed.data.clientId)
    .select("id");
  if (error) return dbError("clients.archive_failed", error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Client not found." };
  }

  revalidateClients();
  return { ok: true, message: archived ? "Client archived." : "Client restored." };
}
