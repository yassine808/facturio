import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. RLS applies (publishable/anon key only —
 * never put a secret key behind NEXT_PUBLIC_*).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
