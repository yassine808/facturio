import { describe, expect, it } from "vitest";
import { inviteSchema, inviteTokenSchema, orgNameSchema } from "./schemas";

describe("orgNameSchema", () => {
  it("trims whitespace", () => {
    expect(orgNameSchema.parse("  Acme  ")).toBe("Acme");
  });

  it("rejects empty and over-long names (DB check is 1..100)", () => {
    expect(orgNameSchema.safeParse("").success).toBe(false);
    expect(orgNameSchema.safeParse("x".repeat(101)).success).toBe(false);
  });
});

describe("inviteSchema", () => {
  it("trims and lowercases the email before validating it", () => {
    const parsed = inviteSchema.parse({ email: "  Bob@Example.COM ", role: "member" });
    expect(parsed.email).toBe("bob@example.com");
  });

  it("rejects invalid emails", () => {
    expect(inviteSchema.safeParse({ email: "not-an-email", role: "member" }).success).toBe(
      false,
    );
  });

  it("never accepts the owner role — owners are promoted in-app", () => {
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "admin" }).success).toBe(true);
  });
});

describe("inviteTokenSchema", () => {
  it("accepts a base64url token (32 bytes → 43 chars)", () => {
    expect(inviteTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
  });

  it("rejects short tokens and base64 (non-url) characters", () => {
    expect(inviteTokenSchema.safeParse("short").success).toBe(false);
    expect(inviteTokenSchema.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
  });
});
