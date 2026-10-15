import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";

/**
 * Service-role client — the only client that bypasses RLS, used by the Stripe
 * webhook handler because ADR-0005 makes that handler the only writer of
 * `subscriptions`. It must never be imported by a Server Action or a page:
 * everything user-facing goes through `createClient()` in `server.ts`, where
 * RLS applies. There is no `import "server-only"` here (the package is not a
 * dependency — ADR-0011 keeps the tree minimal); the guard is that this
 * module reads a non-NEXT_PUBLIC env var, which check:env forbids from ever
 * being exposed to the browser.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SECRET_KEY is not set — the webhook cannot write");
  }
  return createSupabaseJsClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
