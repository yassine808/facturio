"use client";

import { ActionForm, type FormState } from "@/components/action-form";
import { button } from "@/features/auth/form-styles";
import { deletePayment, markInvoicePaid, sendInvoice, voidInvoice } from "./actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const neutralButton = `${button} !w-auto border border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`;
const dangerButton = `${button} !w-auto border border-red-300 bg-transparent text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950`;

/**
 * One status transition per form (house pattern: one action per intent).
 * The DB decides whether the move is legal (status rules + frozen details);
 * here these surface its message verbatim. Voiding gets no client-side
 * confirm in the MVP: it is a distinct, deliberately styled button, and
 * the server rule is the authority either way.
 */
export function InvoiceTransitionForm({
  orgId,
  orgSlug,
  invoiceId,
  to,
}: {
  orgId: string;
  orgSlug: string;
  invoiceId: string;
  to: "send" | "paid" | "void";
}) {
  const action: Action =
    to === "send" ? sendInvoice : to === "paid" ? markInvoicePaid : voidInvoice;
  const label = to === "send" ? "Send invoice" : to === "paid" ? "Mark as paid" : "Void invoice";

  return (
    <ActionForm
      action={action}
      submitLabel={label}
      buttonClassName={to === "void" ? dangerButton : neutralButton}
      className="inline-block"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
    </ActionForm>
  );
}

/**
 * Payment correction: delete + re-record while the invoice is still sent
 * (the DB freezes history once paid — no in-place edits of settled money).
 */
export function DeletePaymentForm({
  orgSlug,
  paymentId,
}: {
  orgSlug: string;
  paymentId: string;
}) {
  return (
    <ActionForm
      action={deletePayment}
      submitLabel="Remove"
      buttonClassName={`${dangerButton} !px-2 !py-1 text-xs`}
      className="inline-block"
    >
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="paymentId" value={paymentId} />
    </ActionForm>
  );
}
