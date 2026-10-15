import { describe, expect, it } from "vitest";
import { generateShareToken, hashShareToken } from "./token";

describe("generateShareToken", () => {
  it("is 43 URL-safe base64url characters", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats itself", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(tokens.size).toBe(50);
  });
});

describe("hashShareToken", () => {
  it("is lowercase 64-hex — the shape the DB CHECK requires", async () => {
    const hash = await hashShareToken(generateShareToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same token", async () => {
    const token = generateShareToken();
    expect(await hashShareToken(token)).toBe(await hashShareToken(token));
  });

  it("separates different tokens (a hash collision here would leak one invoice's link onto another)", async () => {
    const a = await hashShareToken(generateShareToken());
    const b = await hashShareToken(generateShareToken());
    expect(a).not.toBe(b);
  });
});
