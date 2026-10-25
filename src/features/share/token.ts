/**
 * Share-link tokens (ADR-0012): 32 random bytes, shown to the user once,
 * stored only as their sha256. What the database cannot leak, nobody can
 * read — same rule as invitation links since Phase 2.
 *
 * Web Crypto on purpose: these helpers run in server actions (Node) and
 * in the proxy's rate limiter (Edge), and one implementation beats two
 * that drift. Both APIs are async; call sites await.
 */

const TOKEN_BYTES = 32;

/** 43 URL-safe characters (base64url of 32 bytes, padding stripped). */
export function generateShareToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Lowercase 64-char hex — the exact shape the DB CHECK expects. */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
