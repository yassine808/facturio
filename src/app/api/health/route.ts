import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Liveness/readiness endpoint. Always answers 200 while the app runs
 * (Playwright and uptime checks use it); per-check status tells the truth:
 *   env:    ok | invalid
 *   supabase: up | down | unreachable config
 * No secrets in the payload.
 */
export async function GET() {
  const started = Date.now();
  let envCheck: "ok" | "invalid" = "ok";
  let supaCheck: "up" | "down" = "down";
  let detail: string | undefined;

  try {
    const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = env();
    try {
      const res = await fetch(`${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
        headers: { apikey: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(2000),
      });
      supaCheck = res.ok || res.status === 401 || res.status === 403 ? "up" : "down";
      if (supaCheck === "down") detail = `supabase responded ${res.status}`;
    } catch (e) {
      supaCheck = "down";
      detail = "supabase unreachable";
      log("warn", "health.supabase_unreachable", { err: String(e).slice(0, 100) });
    }
  } catch (e) {
    envCheck = "invalid";
    detail = e instanceof Error ? e.message.slice(0, 200) : "invalid env";
    log("error", "health.env_invalid", { detail });
  }

  return NextResponse.json(
    {
      status: "ok",
      env: envCheck,
      supabase: supaCheck,
      uptime_s: Math.round(process.uptime()),
      latency_ms: Date.now() - started,
      time: new Date().toISOString(),
      ...(detail ? { detail } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
