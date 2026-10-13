"use client";

import { ActionForm } from "@/components/action-form";
import { input } from "@/features/auth/form-styles";
import { recordPayment } from "./actions";
import type { Currency } from "./money";

/**
 * Record a manual payment against a sent invoice. The DB guard (payments
 * only while sent, auto paid-flip on coverage) does the real work; this
 * form only collects the three fields it needs.
 */
export function PaymentForm({
  orgId,
  orgSlug,
  invoiceId,
  currency,
}: {
  orgId: string;
  orgSlug: string;
  invoiceId: string;
  currency: Currency;
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionForm action={recordPayment} submitLabel="Record payment">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="currency" value={currency} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium">
            Amount ({currency})
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            placeholder="0.00"
            className={`mt-1 ${input}`}
          />
        </div>
        <div>
          <label htmlFor="paidAt" className="block text-sm font-medium">
            Date
          </label>
          <input
            id="paidAt"
            name="paidAt"
            type="date"
            required
            defaultValue={today}
            max={today}
            className={`mt-1 ${input}`}
          />
        </div>
        <div>
          <label htmlFor="notes" className="block text-sm font-medium">
            Notes <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input id="notes" name="notes" maxLength={500} className={`mt-1 ${input}`} />
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Payments can only be recorded (or corrected by removing) while the invoice is sent.
        Covering the total marks it paid automatically.
      </p>
    </ActionForm>
  );
}
