"use client";

import { useActionState, useState } from "react";
import { input } from "@/features/auth/form-styles";
import { inviteMember } from "./actions";
import type { FormState } from "./types";

const selectCls =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800";
const submitBtn =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";

/**
 * Needs its own useActionState (not ActionForm) because success output is a
 * one-time invite link: the raw token must be rendered from state exactly
 * once, with a copy button — it cannot be re-fetched later.
 */
export function InviteForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(inviteMember, {
    ok: false,
  });

  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            placeholder="teammate@company.com"
            className={input}
          />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">Role</span>
          <select name="role" defaultValue="member" className={selectCls}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
      </div>
      <input type="hidden" name="orgId" value={orgId} />
      <button type="submit" disabled={pending} className={submitBtn}>
        {pending ? "Creating…" : "Create invite link"}
      </button>
      {state.ok && state.token && <InviteLink token={state.token} />}
    </form>
  );
}

function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  // Derived during render instead of an effect: this component only ever
  // renders on the client (the form's server state starts with ok:false, so
  // it is never part of the SSR HTML) — window is always available here.
  const url = `${window.location.origin}/invite/${token}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        This link expires in 7 days and works only once — send it directly to
        the invitee. It will not be shown again.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label="Invitation link"
          onFocus={(event) => event.currentTarget.select()}
          className={input}
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-amber-400 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
