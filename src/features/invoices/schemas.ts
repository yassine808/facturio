import { z } from "zod";
import { CURRENCIES, parseMinor } from "./money";

/**
 * Invoice draft input — header + full line set, validated as one unit so a
 * save can never persist a header whose lines are invalid (and vice versa).
 * Money fields arrive as display strings and convert through parseMinor
 * (integer math); the schema only ever sees the resulting integers.
 */

export const currencySchema = z.enum(CURRENCIES);

const isoDate = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date");

/** One line of the editor: quantity as a decimal string, price as money string. */
export const lineDraftSchema = z.object({
  itemId: z.uuid().nullable(), // null = new row ("" from the form maps to null)
  description: z
    .string()
    .trim()
    .min(1, "Each line needs a description")
    .max(500, "Description must be at most 500 characters"),
  quantity: z.coerce
    .number({ error: "Quantity must be a number" })
    .positive("Quantity must be greater than zero")
    .max(1_000_000, "Quantity is too large"),
  unitPriceMinor: z
    .number()
    .int("Invalid price")
    .min(0, "Price cannot be negative")
    .max(1_000_000_000_000, "Price is too large"),
});
export type LineDraft = z.infer<typeof lineDraftSchema>;

export const invoiceDraftSchema = z
  .object({
    orgId: z.uuid("Invalid organization"),
    orgSlug: z.string().min(1),
    invoiceId: z.uuid().nullable(), // null = create, set = save existing draft
    clientId: z.uuid("Pick a client"),
    currency: currencySchema,
    // Entered as a percent ("20" or "20.5"); converted to basis points by
    // parseMinor (2 decimals = bps precision) before the schema sees it.
    taxRateBps: z
      .number()
      .int("Invalid tax rate")
      .min(0, "Tax rate cannot be negative")
      .max(10_000, "Tax rate cannot exceed 100%"),
    issueDate: isoDate,
    dueDate: isoDate.nullable(),
    notes: z
      .string()
      .trim()
      .max(2000, "Notes must be at most 2000 characters")
      .nullable()
      .transform((v) => (v === "" || v === null ? null : v)),
    lines: z.array(lineDraftSchema).min(1, "An invoice needs at least one line").max(200),
  })
  .refine((v) => v.dueDate === null || v.dueDate >= v.issueDate, {
    message: "Due date must be on or after the issue date",
    path: ["dueDate"],
  });
export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>;

/** Status transitions and payment recording reference rows by id only. */
export const invoiceRefSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  orgSlug: z.string().min(1),
  invoiceId: z.uuid("Invalid invoice"),
});

export const invoiceStatusActionSchema = invoiceRefSchema.extend({
  action: z.enum(["send", "void", "paid"]),
});

export const paymentInputSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  orgSlug: z.string().min(1),
  invoiceId: z.uuid("Invalid invoice"),
  amountMinor: z
    .number({ error: "Enter an amount" })
    .int("Invalid amount")
    .positive("Payment must be greater than zero"),
  paidAt: isoDate,
  notes: z
    .string()
    .trim()
    .max(500, "Notes must be at most 500 characters")
    .nullable()
    .transform((v) => (v === "" || v === null ? null : v)),
});

export const paymentRefSchema = z.object({
  orgSlug: z.string().min(1),
  paymentId: z.uuid("Invalid payment"),
});

/**
 * Tax percent string ("20", "7.5") -> basis points, integer math only —
 * reuses parseMinor's 2-decimal digit concatenation (2 decimals of percent
 * IS basis-point precision: 20.00% -> 2000 bps).
 */
export function taxPercentToBps(input: string): number | null {
  return parseMinor(input.trim(), "EUR");
}
