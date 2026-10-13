"use client";

import { useState } from "react";
import { ActionForm, type FormState } from "@/components/action-form";
import { input } from "@/features/auth/form-styles";
import { CURRENCIES, type Currency, formatMinor } from "./money";
import type { InvoiceDetail, InvoiceItemRow } from "./queries";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Editor state for one line: quantity and price stay display strings —
 * conversion to numbers happens in the action (parseMinor, integer math),
 * so this component never does money arithmetic. */
type DraftLine = {
  itemId: string | null;
  description: string;
  quantity: string;
  price: string;
};

function bpsToPercent(bps: number): string {
  // Integer math again: 2025 bps -> "20.25", never 20.250000000000004.
  return `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}

/**
 * Draft invoice editor: header + dynamic line list in one form. Used for
 * both create (no initial) and edit-draft (initial + existing items); the
 * hidden itemId per line tells the action which rows to update, insert,
 * or delete.
 */
export function InvoiceForm({
  action,
  orgId,
  orgSlug,
  clients,
  initial,
  items,
  submitLabel,
}: {
  action: Action;
  orgId: string;
  orgSlug: string;
  clients: { id: string; name: string }[];
  initial?: InvoiceDetail;
  items?: InvoiceItemRow[];
  submitLabel: string;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial && items && items.length > 0
      ? items.map((item) => ({
          itemId: item.id,
          description: item.description,
          quantity: String(item.quantity),
          price: formatMinor(item.unit_price_minor, initial.currency as Currency),
        }))
      : [{ itemId: null, description: "", quantity: "1", price: "" }],
  );

  const patchLine = (index: number, patch: Partial<DraftLine>): void => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };
  const addLine = (): void => {
    setLines((prev) => [...prev, { itemId: null, description: "", quantity: "1", price: "" }]);
  };
  const removeLine = (index: number): void => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="invoiceId" value={initial?.id ?? ""} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="clientId" className="block text-sm font-medium">
            Client
          </label>
          <select
            id="clientId"
            name="clientId"
            required
            defaultValue={initial?.client_id ?? ""}
            className={`mt-1 ${input}`}
          >
            <option value="" disabled>
              Choose a client…
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="currency" className="block text-sm font-medium">
            Currency
          </label>
          <select
            id="currency"
            name="currency"
            defaultValue={initial?.currency ?? "MAD"}
            className={`mt-1 ${input}`}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="taxRatePercent" className="block text-sm font-medium">
            Tax rate %
          </label>
          <input
            id="taxRatePercent"
            name="taxRatePercent"
            inputMode="decimal"
            required
            defaultValue={initial ? bpsToPercent(initial.tax_rate_bps) : "0"}
            className={`mt-1 ${input}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="issueDate" className="block text-sm font-medium">
              Issue date
            </label>
            <input
              id="issueDate"
              name="issueDate"
              type="date"
              required
              defaultValue={initial?.issue_date ?? today}
              className={`mt-1 ${input}`}
            />
          </div>
          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium">
              Due date
            </label>
            <input
              id="dueDate"
              name="dueDate"
              type="date"
              defaultValue={initial?.due_date ?? ""}
              className={`mt-1 ${input}`}
            />
          </div>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Lines</legend>
        {lines.map((line, index) => (
          <div
            key={line.itemId ?? `new-${index}`}
            className="grid grid-cols-1 gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-[1fr_6rem_8rem_auto]"
          >
            <input type="hidden" name="line_itemId" value={line.itemId ?? ""} />
            <input
              name="line_description"
              placeholder="Description"
              required
              maxLength={500}
              value={line.description}
              onChange={(e) => patchLine(index, { description: e.target.value })}
              className={input}
            />
            <input
              name="line_quantity"
              placeholder="Qty"
              inputMode="decimal"
              required
              value={line.quantity}
              onChange={(e) => patchLine(index, { quantity: e.target.value })}
              className={input}
            />
            <input
              name="line_price"
              placeholder="Unit price"
              inputMode="decimal"
              required
              value={line.price}
              onChange={(e) => patchLine(index, { price: e.target.value })}
              className={input}
            />
            <button
              type="button"
              onClick={() => removeLine(index)}
              disabled={lines.length === 1}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          + Add line
        </button>
      </fieldset>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium">
          Notes <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={initial?.notes ?? ""}
          className={`mt-1 ${input}`}
        />
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Totals and tax are computed by the database when you save — the numbers you see on the
        invoice are the numbers it stored.
      </p>
    </ActionForm>
  );
}
