"use server";

import { createHash, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import {
  inviteRevokeSchema,
  inviteSchema,
  inviteTokenSchema,
  memberRemoveSchema,
  orgNameSchema,
  roleChangeSchema,
} from "./schemas";
import type { SupabaseServer } from "./queries";
import { newSlug } from "./slug";
import type { FormState, OrgRole } from "./types";

/**
 * Every action re-checks authorization server-side (house rule: RLS is the
 * boundary, actions enforce product rules on top). The DB would refuse most
 * of these anyway — the explicit checks turn silent 0-row updates into real
 * error messages for the user.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function firstError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/** Role check via the RLS helper RPC (ADR-0004). Fails closed. */
async function hasRole(
  supabase: SupabaseServer,
  orgId: string,
  roles: OrgRole[],
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_org_role", {
    p_org_id: orgId,
    p_roles: roles,
  });
  if (error) {
    log("error", "orgs.has_role_failed", { orgId, error: error.message });
    return false;
  }
  return data === true;
}

/**
 * Best-effort audit append. A failed audit write is logged loudly but does
 * not fail the user's action — the trail is a product feature, not a gate on
 * the operation itself.
 */
async function writeAudit(
  supabase: SupabaseServer,
  entry: {
    orgId: string;
    actorId: string;
    action: string;
    targetType: "organization" | "membership" | "invitation";
    targetId?: string;
    metadata?: Record<string, string>;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    org_id: entry.orgId,
    actor_id: entry.actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    metadata: entry.metadata ?? {},
  });
  if (error) {
    log("error", "orgs.audit_write_failed", { action: entry.action, error: error.message });
  }
}

export async function createOrg(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = orgNameSchema.safeParse(str(fd, "name"));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  // The random suffix makes collisions practically impossible; retrying a
  // couple of times on 23505 covers the astronomically unlikely case (and
  // the theoretical attacker grinding suffixes).
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = newSlug(parsed.data);
    const { data, error } = await supabase
      .from("organizations")
      .insert({ name: parsed.data, slug })
      .select("slug")
      .single();

    if (!error) {
      // org.created is audited by the DB trigger; nothing to add here.
      revalidatePath("/app", "layout");
      redirect(`/app/${data.slug}`);
    }

    if (error.code !== "23505") {
      log("error", "orgs.create_failed", { code: error.code, error: error.message });
      return { ok: false, error: "Could not create the organization. Try again." };
    }
  }

  return { ok: false, error: "Could not pick a unique URL for this name. Try another name." };
}

export async function inviteMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = inviteSchema.safeParse({ email: str(fd, "email"), role: str(fd, "role") });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const orgId = z.uuid().safeParse(str(fd, "orgId"));
  if (!orgId.success) return { ok: false, error: "Invalid organization" };

  if (!(await hasRole(supabase, orgId.data, ["owner", "admin"]))) {
    return { ok: false, error: "Only owners and admins can invite members" };
  }

  // Raw token travels once, in the invite link; only its sha256 is stored.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      org_id: orgId.data,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "An invitation for this email is already pending. Revoke it first to send a new one.",
      };
    }
    log("error", "orgs.invite_failed", { code: error.code, error: error.message });
    return { ok: false, error: "Could not create the invitation. Try again." };
  }

  await writeAudit(supabase, {
    orgId: orgId.data,
    actorId: user.id,
    action: "member.invited",
    targetType: "invitation",
    targetId: data.id,
    metadata: { role: parsed.data.role },
  });

  revalidatePath("/app", "layout");
  return {
    ok: true,
    token,
    message: "Invitation created. Share the link below — it expires in 7 days.",
  };
}

export async function changeMemberRole(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = roleChangeSchema.safeParse({
    orgId: str(fd, "orgId"),
    membershipId: str(fd, "membershipId"),
    role: str(fd, "role"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { orgId, membershipId, role } = parsed.data;

  if (!(await hasRole(supabase, orgId, ["owner", "admin"]))) {
    return { ok: false, error: "Only owners and admins can change roles" };
  }
  if (role === "owner" && !(await hasRole(supabase, orgId, ["owner"]))) {
    return { ok: false, error: "Only owners can grant the owner role" };
  }

  // RLS filters disallowed rows to zero; an empty result means denied/stale.
  const { data, error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("id", membershipId)
    .select("id");

  if (error) {
    if (error.message.includes("at least one owner")) {
      return { ok: false, error: "An organization must keep at least one owner." };
    }
    log("error", "orgs.role_change_failed", { code: error.code, error: error.message });
    return { ok: false, error: "Could not change the role. Try again." };
  }
  if (data.length === 0) {
    return { ok: false, error: "Member not found, or you cannot change this role." };
  }

  await writeAudit(supabase, {
    orgId,
    actorId: user.id,
    action: "member.role_changed",
    targetType: "membership",
    targetId: membershipId,
    metadata: { role },
  });

  revalidatePath("/app", "layout");
  return { ok: true, message: "Role updated." };
}

export async function removeMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = memberRemoveSchema.safeParse({
    orgId: str(fd, "orgId"),
    membershipId: str(fd, "membershipId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { orgId, membershipId } = parsed.data;

  // Look the row up first: removal rules depend on who it is and their role.
  const { data: row, error: rowError } = await supabase
    .from("memberships")
    .select("id, user_id, role")
    .eq("id", membershipId)
    .maybeSingle();
  if (rowError) {
    log("error", "orgs.member_lookup_failed", { error: rowError.message });
    return { ok: false, error: "Could not look up this member." };
  }
  if (!row) return { ok: false, error: "Member not found." };

  const isSelf = row.user_id === user.id;
  if (!isSelf) {
    if (!(await hasRole(supabase, orgId, ["owner", "admin"]))) {
      return { ok: false, error: "Only owners and admins can remove members" };
    }
    if (row.role === "owner" && !(await hasRole(supabase, orgId, ["owner"]))) {
      return { ok: false, error: "Only owners can remove other owners" };
    }
  }

  const { data, error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", membershipId)
    .select("id");

  if (error) {
    if (error.message.includes("at least one owner")) {
      return {
        ok: false,
        error: "This is the last owner. Promote someone else to owner first.",
      };
    }
    log("error", "orgs.member_remove_failed", { code: error.code, error: error.message });
    return { ok: false, error: "Could not remove the member. Try again." };
  }
  if (data.length === 0) {
    return { ok: false, error: "Member not found, or you cannot remove this member." };
  }

  await writeAudit(supabase, {
    orgId,
    actorId: user.id,
    action: isSelf ? "member.left" : "member.removed",
    targetType: "membership",
    targetId: membershipId,
  });

  revalidatePath("/app", "layout");
  if (isSelf) redirect(`/app`);
  return { ok: true, message: "Member removed." };
}

export async function revokeInvitation(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = inviteRevokeSchema.safeParse({
    orgId: str(fd, "orgId"),
    invitationId: str(fd, "invitationId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { orgId, invitationId } = parsed.data;

  if (!(await hasRole(supabase, orgId, ["owner", "admin"]))) {
    return { ok: false, error: "Only owners and admins can revoke invitations" };
  }

  const { data, error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", invitationId)
    .select("id");

  if (error) {
    log("error", "orgs.revoke_failed", { code: error.code, error: error.message });
    return { ok: false, error: "Could not revoke the invitation. Try again." };
  }
  if (data.length === 0) {
    return { ok: false, error: "Invitation not found, or you cannot revoke it." };
  }

  await writeAudit(supabase, {
    orgId,
    actorId: user.id,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: invitationId,
  });

  revalidatePath("/app", "layout");
  return { ok: true, message: "Invitation revoked." };
}

export async function acceptInvitation(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to accept the invitation" };

  const token = inviteTokenSchema.safeParse(str(fd, "token"));
  if (!token.success) return { ok: false, error: "Invalid invitation link" };

  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token: token.data,
  });
  if (error) {
    log("error", "orgs.accept_rpc_failed", { error: error.message });
    return { ok: false, error: "Could not accept the invitation. Try again." };
  }

  const row = z
    .object({ status: z.string(), org_id: z.uuid().nullable() })
    .safeParse(Array.isArray(data) ? data[0] : null);
  if (!row.success) {
    log("error", "orgs.accept_shape_unexpected", { count: Array.isArray(data) ? data.length : 0 });
    return { ok: false, error: "Could not accept the invitation. Try again." };
  }

  if (row.data.status === "wrong_email") {
    return {
      ok: false,
      error: "This invitation was issued to a different email address. Sign in with that account to accept it.",
    };
  }
  if (row.data.status !== "accepted" || !row.data.org_id) {
    return {
      ok: false,
      error: "This invitation is invalid, expired, or has already been used.",
    };
  }

  // We are a member now, so the slug lookup is visible under RLS.
  const { data: org } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", row.data.org_id)
    .maybeSingle();

  revalidatePath("/app", "layout");
  redirect(org?.slug ? `/app/${org.slug}` : "/app");
}
