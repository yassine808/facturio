"use client";

import { ActionForm } from "@/components/action-form";
import { changeMemberRole, removeMember, revokeInvitation } from "./actions";
import type { OrgRole } from "./types";

const selectCls =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800";
const subtleBtn =
  "shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";
const dangerBtn =
  "shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";

/**
 * Role change + remove/leave controls for one member row. The can* booleans
 * are computed on the server from the caller's role — this component only
 * renders what it is allowed to render; the action re-checks anyway.
 */
export function MemberRowActions({
  orgId,
  membershipId,
  role,
  isSelf,
  canChangeRole,
  canGrantOwner,
  canRemove,
}: {
  orgId: string;
  membershipId: string;
  role: OrgRole;
  isSelf: boolean;
  canChangeRole: boolean;
  canGrantOwner: boolean;
  canRemove: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canChangeRole && (
        <ActionForm
          action={changeMemberRole}
          submitLabel="Save"
          pendingLabel="Saving…"
          buttonClassName={subtleBtn}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <select name="role" defaultValue={role} aria-label="New role" className={selectCls}>
            <option value="member">member</option>
            <option value="admin">admin</option>
            {canGrantOwner && <option value="owner">owner</option>}
          </select>
        </ActionForm>
      )}
      {canRemove && (
        <ActionForm
          action={removeMember}
          submitLabel={isSelf ? "Leave" : "Remove"}
          pendingLabel="…"
          buttonClassName={dangerBtn}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="membershipId" value={membershipId} />
        </ActionForm>
      )}
    </div>
  );
}

export function RevokeInviteButton({ orgId, invitationId }: { orgId: string; invitationId: string }) {
  return (
    <ActionForm
      action={revokeInvitation}
      submitLabel="Revoke"
      pendingLabel="…"
      buttonClassName={subtleBtn}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="invitationId" value={invitationId} />
    </ActionForm>
  );
}
