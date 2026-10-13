"use client";

import { ActionForm, type FormState } from "@/components/action-form";
import { button, input } from "@/features/auth/form-styles";
import { archiveClient, restoreClient } from "./actions";
import type { ClientRow } from "./queries";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * Create/edit form for one client. Hidden ids are untrusted input by
 * design — the action re-validates them and RLS scopes the write, so a
 * forged clientId edits nothing.
 */
export function ClientForm({
  action,
  orgId,
  orgSlug,
  initial,
  submitLabel,
}: {
  action: Action;
  orgId: string;
  orgSlug: string;
  initial?: ClientRow;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      {initial && <input type="hidden" name="clientId" value={initial.id} />}

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
          className={`mt-1 ${input}`}
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={initial?.email ?? ""}
          className={`mt-1 ${input}`}
        />
      </div>

      <div>
        <label htmlFor="address" className="block text-sm font-medium">
          Address <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="address"
          name="address"
          rows={3}
          maxLength={2000}
          defaultValue={initial?.address ?? ""}
          className={`mt-1 ${input}`}
        />
      </div>
    </ActionForm>
  );
}

/** Archive/restore is its own one-field form (house pattern: one action per intent). */
export function ArchiveClientControl({
  orgSlug,
  client,
}: {
  orgSlug: string;
  client: ClientRow;
}) {
  const archived = client.archived_at !== null;
  const style = archived
    ? button
    : `${button} border border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`;

  return (
    <ActionForm
      action={archived ? restoreClient : archiveClient}
      submitLabel={archived ? "Restore client" : "Archive client"}
      buttonClassName={`${style} !w-auto`}
      className="inline-block"
    >
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="clientId" value={client.id} />
    </ActionForm>
  );
}
