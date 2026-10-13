import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

/**
 * Email confirmation link target. Supabase emails carry `token_hash` + `type`
 * (template configured with {{ .TokenHash }} in the confirm-signup template);
 * verifyOtp exchanges them for a session — cookies are written by the server
 * client, then we redirect onward.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/app";

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "signup" | "recovery" | "email_change",
  });

  if (error) {
    log("warn", "auth.confirm_failed", { reason: error.message });
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  return NextResponse.redirect(`${origin}${target}`);
}
