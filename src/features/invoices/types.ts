import type { FormState } from "@/components/action-form";

export type { FormState };

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Overdue is derived, never stored (PLAN §5): a sent invoice whose due_date
 * has passed. Pure string comparison — ISO dates sort lexicographically —
 * so it cannot go stale the way a stored flag would.
 */
export function isOverdue(status: InvoiceStatus, dueDate: string | null, today: string): boolean {
  return status === "sent" && dueDate !== null && dueDate < today;
}
