import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

/**
 * OAuth (Google/GitHub) PKCE callback: exchanges the `code` query param for a
 * session. Without this route OAuth sign-in never completes.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    log("warn", "auth.oauth_exchange_failed", { reason: error.message });
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  return NextResponse.redirect(`${origin}${target}`);
}
