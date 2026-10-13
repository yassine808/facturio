import { describe, expect, it } from "vitest";
import { formatMinor, isIsoDate, parseMinor } from "./money";

describe("parseMinor", () => {
  it("parses major and fraction into minor units by digit concatenation", () => {
    expect(parseMinor("1234.56", "MAD")).toBe(123456);
    expect(parseMinor("0.05", "EUR")).toBe(5);
    expect(parseMinor("7", "USD")).toBe(700);
  });

  it("trims surrounding whitespace", () => {
    expect(parseMinor("  1.00  ", "MAD")).toBe(100);
  });

  it("rejects more decimals than the currency has", () => {
    expect(parseMinor("1.999", "MAD")).toBeNull();
  });

  it("rejects negatives, garbage, and empty input", () => {
    expect(parseMinor("-5", "MAD")).toBeNull();
    expect(parseMinor("abc", "MAD")).toBeNull();
    expect(parseMinor("", "MAD")).toBeNull();
    expect(parseMinor("1.2.3", "MAD")).toBeNull();
  });

  it("rejects values beyond safe-integer range instead of silently rounding", () => {
    expect(parseMinor("99999999999999999", "MAD")).toBeNull();
  });
});

describe("formatMinor", () => {
  it("formats with the currency's exponent and no float math", () => {
    expect(formatMinor(123456, "MAD")).toBe("1234.56 MAD");
    expect(formatMinor(5, "EUR")).toBe("0.05 EUR");
    expect(formatMinor(700, "USD")).toBe("7.00 USD");
    expect(formatMinor(0, "MAD")).toBe("0.00 MAD");
  });

  it("round-trips with parseMinor", () => {
    for (const input of ["0.00", "0.01", "999999999.99", "42"]) {
      const minor = parseMinor(input, "MAD");
      expect(minor).not.toBeNull();
      // "42" formats as "42.00" — the currency exponent always shows.
      const expected = input.includes(".") ? input : `${input}.00`;
      expect(formatMinor(minor as number, "MAD")).toBe(`${expected} MAD`);
    }
  });
});

describe("isIsoDate", () => {
  it("accepts real yyyy-mm-dd dates", () => {
    expect(isIsoDate("2026-10-13")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-2-1")).toBe(false);
    expect(isIsoDate("not-a-date")).toBe(false);
  });
});
