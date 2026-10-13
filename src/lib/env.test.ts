import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "./env";

const KEY = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

function setValidEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
}

beforeEach(() => {
  setValidEnv();
  resetEnvCache();
});

afterEach(() => {
  resetEnvCache();
});

describe("env()", () => {
  it("returns validated values when all vars are set", () => {
    const e = env();
    expect(e.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(e.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("throws when a var is missing (fail fast, not null in prod)", () => {
    delete process.env[KEY];
    resetEnvCache();
    expect(() => env()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("throws when the URL is not a valid URL", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    resetEnvCache();
    expect(() => env()).toThrow();
  });

  it("caches the parsed value (env is read on hot paths)", () => {
    env();
    delete process.env[KEY];
    // cached result survives — only resetEnvCache() invalidates
    expect(() => env()).not.toThrow();
  });
});
