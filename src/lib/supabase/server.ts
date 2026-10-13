import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (Server Components, Server Actions, Route
 * Handlers). RLS applies because we use the publishable key + session cookie.
 *
 * Identity check: always call `supabase.auth.getUser()` / `getClaims()` —
 * `getSession()` trusts the cookie and must not gate access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Expected in Server Components: they cannot write cookies.
            // The cookie refresh happens in src/proxy.ts, which runs first
            // and owns Set-Cookie. This is the official @supabase/ssr pattern.
          }
        },
      },
    },
  );
}
