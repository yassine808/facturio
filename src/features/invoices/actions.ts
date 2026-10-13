"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { log } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { parseMinor, isIsoDate, todayIso, CURRENCIES } from "./money";
import { listInvoiceItems } from "./queries";
import {
  invoiceDraftSchema,
  invoiceRefSchema,
  paymentInputSchema,
  paymentRefSchema,
  taxPercentToBps,
} from "./schemas";
import type { FormState } from "./types";

/**
 * Invoice, line, status, and payment actions.
 *
 * House rules in play: Zod at the boundary, the DB is the final authority
 * (RLS scoping + the trigger rules from Phase 3's migrations), and errors
 * surface as messages a user can act on. P0001 messages come straight from
 * the triggers — they are written for humans ("invoices start as drafts…"),
 * so they pass through verbatim instead of being re-worded in five places.
 */

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function firstError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/** Logs the raw error, returns a message safe (and useful) to show. */
function dbError(context: string, error: { code?: string | null; message: string }): FormState {
  log("error", context, { code: error.code ?? "", error: error.message });
  switch (error.code) {
    case "P0001": // trigger guard — the message is written for the user
      return { ok: false, error: error.message };
    case "42501":
      return { ok: false, error: "You do not have permission to do that." };
    case "23514":
      return { ok: false, error: "One of the values you entered is not allowed." };
    case "23503":
      return { ok: false, error: "That record does not exist in this organization." };
    case "23502":
      return { ok: false, error: "A required value was missing." };
    default:
      return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Builds the validated draft input from form fields. Line money strings
 * convert through parseMinor (integer-only); tax percent converts to basis
 * points the same way. Returns { error } for anything the schema refuses.
 */

async function buildDraft(
  fd: FormData,
): Promise<
  | { data: z.infer<typeof invoiceDraftSchema> }
  | { error: string }
> {
  const descriptions = fd.getAll("line_description");
  const quantities = fd.getAll("line_quantity");
  const prices = fd.getAll("line_price");
  const itemIds = fd.getAll("line_itemId");

  if (
    descriptions.length !== quantities.length ||
    descriptions.length !== prices.length ||
    descriptions.length !== itemIds.length
  ) {
    return { error: "The line editor submitted inconsistent rows — reload the page and retry." };
  }

  const currencyRaw = str(fd, "currency");
  const currency = z.enum(CURRENCIES).safeParse(currencyRaw);
  if (!currency.success) return { error: "Pick a currency." };

  const lines: {
    itemId: string | null;
    description: string;
    quantity: string;
    unitPriceMinor: number;
  }[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    // Locals first: TypeScript cannot narrow a let-indexed FormDataEntryValue
    // by typeof in place, and every field here must be a string.
    const rawPrice = prices[i];
    const rawItemId = itemIds[i];
    const rawDescription = descriptions[i];
    const rawQuantity = quantities[i];

    const price = parseMinor(typeof rawPrice === "string" ? rawPrice : "", currency.data);
    if (price === null) {
      return { error: `Line ${i + 1}: enter a valid price like 1234.56.` };
    }
    const itemId = typeof rawItemId === "string" ? rawItemId : "";
    lines.push({
      itemId: itemId === "" ? null : itemId,
      description: typeof rawDescription === "string" ? rawDescription : "",
      quantity: typeof rawQuantity === "string" ? rawQuantity : "",
      unitPriceMinor: price,
    });
  }

  const taxRateBps = taxPercentToBps(str(fd, "taxRatePercent"));
  if (taxRateBps === null) return { error: "Enter a tax rate like 20 or 7.5." };

  const dueRaw = str(fd, "dueDate");
  const parsed = invoiceDraftSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    invoiceId: str(fd, "invoiceId") || null,
    clientId: str(fd, "clientId"),
    currency: currency.data,
    taxRateBps,
    issueDate: str(fd, "issueDate"),
    dueDate: dueRaw === "" ? null : dueRaw,
    notes: str(fd, "notes"),
    lines,
  });
  if (!parsed.success) return { error: firstError(parsed.error) };
  return { data: parsed.data };
}

export async function createInvoice(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const draft = await buildDraft(fd);
  if ("error" in draft) return { ok: false, error: draft.error };
  const d = draft.data;
  if (d.invoiceId !== null) return { ok: false, error: "Unexpected invoice id on create." };

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      org_id: d.orgId,
      client_id: d.clientId,
      currency: d.currency,
      tax_rate_bps: d.taxRateBps,
      issue_date: d.issueDate,
      due_date: d.dueDate,
      notes: d.notes,
    })
    .select("id")
    .single();
  if (error) return dbError("invoices.create_failed", error);

  const { error: itemError } = await supabase.from("invoice_items").insert(
    d.lines.map((line, index) => ({
      org_id: d.orgId,
      invoice_id: data.id,
      position: index,
      description: line.description,
      quantity: line.quantity,
      unit_price_minor: line.unitPriceMinor,
    })),
  );
  if (itemError) {
    // Honest partial-failure message: the header exists as a draft, the
    // lines did not land. Validation upstream makes this rare.
    dbError("invoices.lines_create_failed", itemError);
    return {
      ok: false,
      error:
        "The invoice was created but its lines could not be saved. Open the draft and add them again.",
    };
  }

  revalidatePath("/app", "layout");
  redirect(`/app/${d.orgSlug}/invoices/${data.id}`);
}

export async function updateInvoice(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const draft = await buildDraft(fd);
  if ("error" in draft) return { ok: false, error: draft.error };
  const d = draft.data;
  if (d.invoiceId === null) return { ok: false, error: "Missing invoice id." };

  // Header first: the frozen-details guard runs here (a sent invoice
  // rejects any detail change), so nothing touches lines on a frozen row.
  const { data, error } = await supabase
    .from("invoices")
    .update({
      client_id: d.clientId,
      currency: d.currency,
      tax_rate_bps: d.taxRateBps,
      issue_date: d.issueDate,
      due_date: d.dueDate,
      notes: d.notes,
    })
    .eq("org_id", d.orgId)
    .eq("id", d.invoiceId)
    .select("id");
  if (error) return dbError("invoices.update_failed", error);
  if (!data || data.length === 0) return { ok: false, error: "Invoice not found." };

  const current = await listInvoiceItems(supabase, d.orgId, d.invoiceId);
  const submittedIds = new Set(
    d.lines.map((l) => l.itemId).filter((id): id is string => id !== null),
  );

  // In place updates first, inserts next, deletes last: a failure midway
  // never loses existing rows, and resubmitting converges to the same state.
  for (const line of d.lines) {
    if (line.itemId === null) continue;
    const { error: updateError } = await supabase
      .from("invoice_items")
      .update({
        description: line.description,
        quantity: line.quantity,
        unit_price_minor: line.unitPriceMinor,
      })
      .eq("org_id", d.orgId)
      .eq("id", line.itemId);
    if (updateError) return dbError("invoices.item_update_failed", updateError);
  }

  const newLines = d.lines.filter((l) => l.itemId === null);
  if (newLines.length > 0) {
    const { error: insertError } = await supabase.from("invoice_items").insert(
      newLines.map((line, index) => ({
        org_id: d.orgId,
        invoice_id: d.invoiceId,
        position: current.length + index,
        description: line.description,
        quantity: line.quantity,
        unit_price_minor: line.unitPriceMinor,
      })),
    );
    if (insertError) return dbError("invoices.item_insert_failed", insertError);
  }

  const removedIds = current.map((row) => row.id).filter((id) => !submittedIds.has(id));
  if (removedIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("invoice_items")
      .delete()
      .eq("org_id", d.orgId)
      .in("id", removedIds);
    if (deleteError) return dbError("invoices.item_delete_failed", deleteError);
  }

  revalidatePath("/app", "layout");
  return { ok: true, message: "Invoice saved." };
}

async function transitionInvoice(
  fd: FormData,
  to: "sent" | "paid" | "void",
  successMessage: string,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = invoiceRefSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    invoiceId: str(fd, "invoiceId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: to })
    .eq("org_id", parsed.data.orgId)
    .eq("id", parsed.data.invoiceId)
    .select("id");
  if (error) return dbError(`invoices.transition_${to}_failed`, error);
  if (!data || data.length === 0) return { ok: false, error: "Invoice not found." };

  revalidatePath("/app", "layout");
  return { ok: true, message: successMessage };
}

export async function sendInvoice(_prev: FormState, fd: FormData): Promise<FormState> {
  return transitionInvoice(fd, "sent", "Invoice sent — number assigned.");
}

export async function voidInvoice(_prev: FormState, fd: FormData): Promise<FormState> {
  return transitionInvoice(fd, "void", "Invoice voided.");
}

export async function markInvoicePaid(_prev: FormState, fd: FormData): Promise<FormState> {
  return transitionInvoice(fd, "paid", "Invoice marked as paid.");
}

export async function recordPayment(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const currency = z.enum(CURRENCIES).safeParse(str(fd, "currency"));
  if (!currency.success) return { ok: false, error: "Invalid currency." };
  const amountMinor = parseMinor(str(fd, "amount"), currency.data);
  if (amountMinor === null || amountMinor <= 0) {
    return { ok: false, error: "Enter a payment amount like 1234.56." };
  }

  const paidAt = str(fd, "paidAt") || todayIso();
  if (!isIsoDate(paidAt)) return { ok: false, error: "Enter a valid payment date." };
  if (paidAt > todayIso()) return { ok: false, error: "A payment cannot be dated in the future." };

  const parsed = paymentInputSchema.safeParse({
    orgId: str(fd, "orgId"),
    orgSlug: str(fd, "orgSlug"),
    invoiceId: str(fd, "invoiceId"),
    amountMinor,
    paidAt,
    notes: str(fd, "notes"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await supabase.from("payments").insert({
    org_id: parsed.data.orgId,
    invoice_id: parsed.data.invoiceId,
    amount_minor: parsed.data.amountMinor,
    paid_at: parsed.data.paidAt,
    notes: parsed.data.notes,
  });
  if (error) return dbError("payments.create_failed", error);

  revalidatePath("/app", "layout");
  return { ok: true, message: "Payment recorded." };
}

export async function deletePayment(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const parsed = paymentRefSchema.safeParse({
    orgSlug: str(fd, "orgSlug"),
    paymentId: str(fd, "paymentId"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data, error } = await supabase
    .from("payments")
    .delete()
    .eq("id", parsed.data.paymentId)
    .select("id");
  if (error) return dbError("payments.delete_failed", error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Payment not found (or the invoice is already paid)." };
  }

  revalidatePath("/app", "layout");
  return { ok: true, message: "Payment removed." };
}
