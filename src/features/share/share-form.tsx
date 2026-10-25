"use client";

import { useActionState, useState } from "react";
import { ActionForm, type FormState } from "@/components/action-form";
import { button } from "@/features/auth/form-styles";
import { createShareLink, revokeShareLink } from "./actions";

const neutralButton = `${button} !w-auto border border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`;
const dangerButton = `${button} !w-auto border border-red-300 bg-transparent text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950`;

/**
 * Minting needs its own useActionState (not ActionForm) because success
 * output is a one-time share URL: the raw token is rendered from state
 * exactly once with a copy button — the server keeps only its hash
 * (ADR-0012), so it cannot be re-fetched later. Revocation stays on the
 * house ActionForm pattern, one form per link.
 *
 * The list holds live links only (the server filters); a revoked or
 * expired link vanishes from the page on the next render.
 */
export function ShareLinkForm({
  orgId,
  orgSlug,
  invoiceId,
  links,
}: {
  orgId: string;
  orgSlug: string;
  invoiceId: string;
  links: { id: string; expiresAtLabel: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createShareLink,
    {
      ok: false,
    },
  );

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <button type="submit" disabled={pending} className={neutralButton}>
          {pending ? "Creating…" : "Create share link"}
        </button>
        {state.ok && state.token && <ShareLinkOnce token={state.token} />}
      </form>

      {links.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="text-zinc-600 dark:text-zinc-400">
                Live link · expires {link.expiresAtLabel}
              </span>
              <RevokeShareLinkForm
                orgId={orgId}
                orgSlug={orgSlug}
                invoiceId={invoiceId}
                linkId={link.id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RevokeShareLinkForm({
  orgId,
  orgSlug,
  invoiceId,
  linkId,
}: {
  orgId: string;
  orgSlug: string;
  invoiceId: string;
  linkId: string;
}) {
  return (
    <ActionForm
      action={revokeShareLink}
      submitLabel="Revoke"
      pendingLabel="Revoking…"
      buttonClassName={`${dangerButton} !px-2 !py-1 text-xs`}
      className="inline-block"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="linkId" value={linkId} />
    </ActionForm>
  );
}

function ShareLinkOnce({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  // Derived during render, not in an effect: like InviteLink, this only
  // renders on the client (initial state is ok:false, so the URL is
  // never part of the SSR HTML) — window is always available here.
  const url = `${window.location.origin}/share/${token}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Anyone with this link can read the invoice — send it directly to your client. It
        is shown only once; revoke it below if it ever leaks.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label="Share link"
          onFocus={(event) => event.currentTarget.select()}
          className="flex-1 rounded-md border border-amber-400 bg-white px-3 py-2 text-sm text-zinc-900 outline-none dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-100"
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
