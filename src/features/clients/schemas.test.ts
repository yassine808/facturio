import { describe, expect, it } from "vitest";
import { clientRefSchema, clientSchema } from "./schemas";

const valid = {
  orgId: "2b0df1b8-0000-4000-8000-000000000001",
  orgSlug: "acme-3f2a",
  name: "Acme Corp",
  email: "billing@acme.example",
  address: "1 Main St",
};

describe("clientSchema", () => {
  it("accepts a full client", () => {
    expect(clientSchema.parse(valid)).toEqual(valid);
  });

  it("stores an empty email as null, never as an empty string", () => {
    const parsed = clientSchema.parse({ ...valid, email: "" });
    expect(parsed.email).toBeNull();
  });

  it("stores an empty address as null", () => {
    const parsed = clientSchema.parse({ ...valid, address: "   " });
    expect(parsed.address).toBeNull();
  });

  it("trims and lowercases the email before validating it", () => {
    const parsed = clientSchema.parse({ ...valid, email: "  Billing@Acme.EXAMPLE " });
    expect(parsed.email).toBe("billing@acme.example");
  });

  it("rejects invalid emails but allows the field to stay empty", () => {
    expect(clientSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(clientSchema.safeParse({ ...valid, email: "" }).success).toBe(true);
  });

  it("enforces the DB's 1..200 name bounds", () => {
    expect(clientSchema.safeParse({ ...valid, name: "  " }).success).toBe(false);
    expect(clientSchema.safeParse({ ...valid, name: "x".repeat(201) }).success).toBe(false);
  });
});

describe("clientRefSchema", () => {
  it("requires a real uuid for the client id", () => {
    expect(
      clientRefSchema.safeParse({ orgSlug: "acme", clientId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      clientRefSchema.safeParse({ orgSlug: "acme", clientId: valid.orgId }).success,
    ).toBe(true);
  });
});
