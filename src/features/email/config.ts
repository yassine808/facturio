/**
 * Email transport by configuration (ADR-0008): RESEND_API_KEY wins,
 * then EMAIL_SMTP_URL (dev → Mailpit), else the app runs in documented
 * "email disabled" mode — the UI says so honestly and the share link
 * stays copyable, same pattern as billing-disabled in Phase 4.
 *
 * EMAIL_FROM is required by both real transports (every provider
 * rejects a missing or unverified sender), so a transport without it
 * resolves to disabled rather than failing on the first send.
 * resolveEmailConfig is pure — the tests drive it with literal env
 * objects; currentEmailConfig is the one place process.env is read.
 */

export type EmailConfig =
  | { mode: "resend"; apiKey: string; from: string }
  | { mode: "smtp"; smtpUrl: string; from: string }
  | { mode: "disabled" };

export type SendableEmailConfig = Exclude<EmailConfig, { mode: "disabled" }>;

export function resolveEmailConfig(env: {
  RESEND_API_KEY?: string;
  EMAIL_SMTP_URL?: string;
  EMAIL_FROM?: string;
}): EmailConfig {
  const from = env.EMAIL_FROM?.trim() ?? "";
  const resendKey = env.RESEND_API_KEY?.trim() ?? "";
  const smtpUrl = env.EMAIL_SMTP_URL?.trim() ?? "";

  if (resendKey !== "" && from !== "") {
    return { mode: "resend", apiKey: resendKey, from };
  }
  if (smtpUrl !== "" && from !== "") {
    return { mode: "smtp", smtpUrl, from };
  }
  return { mode: "disabled" };
}

export function currentEmailConfig(): EmailConfig {
  return resolveEmailConfig({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_SMTP_URL: process.env.EMAIL_SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });
}
