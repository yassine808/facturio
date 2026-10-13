import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly "middleware"). Responsibilities:
 *  1. Refresh the Supabase session cookie on every request — Server
 *     Components cannot write cookies, so this is the only place refresh
 *     happens. Returning `supabaseResponse` untouched is critical.
 *  2. Coarse route gate: /app/* and /admin/* require a session.
 *     This is defense-in-depth only — real authorization happens inside each
 *     server action / page via getUser() and again in the database via RLS.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not add code between createServerClient and getUser(): reading the
  // session is what triggers the refresh. getUser() verifies the JWT with
  // the Auth server (getSession() would only trust the cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsSession = path.startsWith("/app") || path.startsWith("/admin");
  const isAuthPage =
    path === "/login" || path === "/signup" || path === "/forgot-password";

  let redirectUrl: URL | null = null;

  if (!user && needsSession) {
    redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
  } else if (user && isAuthPage) {
    redirectUrl = new URL("/app", request.url);
  }

  if (redirectUrl) {
    const redirect = NextResponse.redirect(redirectUrl);
    // Carry refreshed cookies onto the redirect or the session is lost.
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    for (const header of ["cache-control", "expires", "pragma"] as const) {
      const value = supabaseResponse.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }
    return redirect;
  }

  return supabaseResponse;
}

export const config = {
  // Skip static assets; everything else goes through session refresh.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
