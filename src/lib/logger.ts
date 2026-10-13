/**
 * Structured JSON logger — one JSON object per line so log aggregators can
 * parse them. Never log secrets or PII: keys that look sensitive are redacted
 * here as a second line of defense (callers must still not pass them).
 */
const SENSITIVE_KEY = /password|secret|token|key|authorization|cookie|email/i;

export type LogLevel = "debug" | "info" | "warn" | "error";

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : v;
  }
  return out;
}

export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...sanitize(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
