/** Shared types for the orgs feature (importable from client and server). */

export type OrgRole = "owner" | "admin" | "member";

/**
 * State returned by every orgs server action. Defined once next to the
 * ActionForm component that renders it (client and server import the same
 * shape); `token` is only ever set by the invite action — the raw token,
 * shown to the inviter exactly once.
 */
export type { FormState } from "@/components/action-form";
