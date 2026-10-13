import { describe, expect, it } from "vitest";
import { newSlug, slugifyBase } from "./slug";

describe("slugifyBase", () => {
  it("lowercases and dash-joins words", () => {
    expect(slugifyBase("Acme Studio")).toBe("acme-studio");
  });

  it("strips punctuation and trims dangling dashes", () => {
    expect(slugifyBase("  ---Hello--- World!! ")).toBe("hello-world");
  });

  it("drops non-ascii characters (lossy by design — slug is a URL handle)", () => {
    expect(slugifyBase("Ümlaut Café")).toBe("mlaut-caf");
  });

  it("falls back to 'org' when nothing usable remains", () => {
    expect(slugifyBase("!!!")).toBe("org");
    expect(slugifyBase("")).toBe("org");
  });

  it("caps the base at 40 chars without ending in a dash", () => {
    const base = slugifyBase(`${"a".repeat(39)} bbbb`);
    expect(base.length).toBeLessThanOrEqual(40);
    expect(base.endsWith("-")).toBe(false);
  });
});

describe("newSlug", () => {
  it("is the name base plus an 8-char hex suffix", () => {
    expect(newSlug("Acme Studio")).toMatch(/^acme-studio-[0-9a-f]{8}$/);
  });

  it("always satisfies the organizations.slug CHECK regex", () => {
    const check = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    expect(newSlug("Acme Studio")).toMatch(check);
    expect(newSlug("Ümlaut!")).toMatch(check);
    expect(newSlug("")).toMatch(check);
  });

  it("produces a different slug per call (collision odds ~2^-32)", () => {
    expect(newSlug("Acme")).not.toBe(newSlug("Acme"));
  });
});
