/**
 * Money stays integer minor units from input to display (ADR-0003). Even
 * the string conversions here are integer-only — no float ever touches a
 * money value in this codebase, not even for formatting.
 *
 * All MVP currencies use the common 2-decimal exponent; the record exists
 * so adding a 0-decimal currency (e.g. JPY) is a one-line change, not an
 * archaeology dig.
 */

export const CURRENCIES = ["MAD", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const EXPONENTS: Record<Currency, number> = { MAD: 2, EUR: 2, USD: 2 };

/** 123456 -> "1234.56 MAD" (integer math only; see header). */
export function formatMinor(minor: number, currency: Currency): string {
  const exp = EXPONENTS[currency];
  const scale = 10 ** exp;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.trunc(abs / scale);
  const frac = String(abs % scale).padStart(exp, "0");
  return `${sign}${major}.${frac} ${currency}`;
}

/**
 * "1234.56" -> 123456. Parses by digit concatenation — major + padded
 * fraction — so no multiplication or division happens at all.
 *
 * Returns null (never throws, never rounds) for: non-numeric input,
 * negatives, more decimals than the currency has, or values that would
 * exceed safe-integer range. Callers surface null as a form error.
 */
export function parseMinor(input: string, currency: Currency): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) return null;

  const exp = EXPONENTS[currency];
  const fraction = match[2] ?? "";
  if (fraction.length > exp) return null;

  const digits = match[1] + fraction.padEnd(exp, "0");
  const minor = Number(digits);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** True for "2026-10-13"-shaped strings (what <input type="date"> submits). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today in UTC, shaped like an input-type=date value. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
