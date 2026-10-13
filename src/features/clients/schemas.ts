import { z } from "zod";

/**
 * Client input. Email/address accept an empty string from the form and
 * transform it to null — an optional field is stored as NULL, not as "",
 * so "has an email" stays a one-column check everywhere downstream.
 */
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email")
  .transform((v) => (v === "" ? null : v));

const optionalAddress = z
  .string()
  .trim()
  .max(2000, "Address must be at most 2000 characters")
  .transform((v) => (v === "" ? null : v));

export const clientSchema = z.object({
  orgId: z.uuid("Invalid organization"),
  orgSlug: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name must be at most 200 characters"),
  email: optionalEmail,
  address: optionalAddress,
});

/** Archive/restore only need the row; RLS scopes the update to the org. */
export const clientRefSchema = z.object({
  orgSlug: z.string().min(1),
  clientId: z.uuid("Invalid client"),
});

export type ClientInput = z.infer<typeof clientSchema>;
