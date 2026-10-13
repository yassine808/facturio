import { z } from "zod";

/** Organization name: trimmed, bounded (DB check allows 1..100). */
export const orgNameSchema = z
  .string()
  .trim()
  .min(1, "Organization name is required")
  .max(100, "Organization name must be at most 100 characters");

/**
 * Invite form input. Emails are lowercased here because acceptance compares
 * against auth.users.email (stored lowercase by Supabase) — a stored
 * mixed-case email would never match. Invited roles stop at admin: becoming
 * an owner is an in-app promotion, keeping last-owner math out of invites.
 */
export const inviteSchema = z.object({
  // trim + lowercase BEFORE validation: " bob@x.co " must not fail, and the
  // stored value must match auth.users.email (lowercase) at acceptance time.
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  role: z.enum(["member", "admin"]),
});

export const roleChangeSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  membershipId: z.uuid("Invalid member"),
  role: z.enum(["member", "admin", "owner"]),
});

export const memberRemoveSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  membershipId: z.uuid("Invalid member"),
});

export const inviteRevokeSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  invitationId: z.uuid("Invalid invitation"),
});

/**
 * Invite tokens are 32 random bytes in base64url (43 chars). The regex is
 * intentionally a little loose so the format can evolve without stranding
 * links; the real check is the sha256 lookup in the database.
 */
export const inviteTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, "Invalid invitation link");

export type InviteInput = z.infer<typeof inviteSchema>;
