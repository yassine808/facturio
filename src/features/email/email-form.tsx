"use client";

import { ActionForm } from "@/components/action-form";
import { input } from "@/features/auth/form-styles";
import { sendInvoiceByEmail } from "./actions";

/**
 * Plain ActionForm — no one-time output to render: the share URL the
 * server mints for the email is never shown here (the user gets their
 * own copyable link from ShareLinkForm instead).
 */
export function EmailInvoiceForm({
  orgSlug,
  invoiceId,
  to,
}: {
  orgSlug: string;
  invoiceId: string;
  to: string;
}) {
  return (
    <ActionForm
      action={sendInvoiceByEmail}
      submitLabel="Email invoice"
      pendingLabel="Sending…"
    >
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label className="block text-sm">
        <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Recipient</span>
        <input
          type="email"
          name="to"
          required
          defaultValue={to}
          placeholder="client@example.com"
          className={input}
        />
      </label>
    </ActionForm>
  );
}
