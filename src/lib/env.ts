import { z } from "zod";

/**
 * Environment validation (Zod) — runs on the server only.
 * Fail loudly at first use instead of shipping `undefined` into auth calls.
 * Client components must reference their public env vars directly (Next.js
 * inlines static public-env references at build time; dynamic key access
 * does not work in the browser bundle).
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Invalid environment configuration — copy .env.example to .env.local and fill it in. ${issues}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: clears the cache so tests can vary process.env. */
export function resetEnvCache(): void {
  cached = null;
}
