import { Resend } from "resend";
import nodemailer from "nodemailer";
import { log } from "@/lib/logger";
import type { SendableEmailConfig } from "./config";

/**
 * The two transports (ADR-0008), one call shape. Both carry the same
 * invoice PDF buffer as an attachment: Resend via its API, Mailpit (or
 * any SMTP relay) via nodemailer. Failure is a returned value, never a
 * throw — the action turns it into a message the user can act on.
 */

export type SendInvoiceEmailParams = {
  config: SendableEmailConfig;
  to: string;
  subject: string;
  text: string;
  html: string;
  pdf: Buffer;
  pdfFilename: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendInvoiceEmail(
  params: SendInvoiceEmailParams,
): Promise<SendResult> {
  const { config, to, subject, text, html, pdf, pdfFilename } = params;

  try {
    if (config.mode === "resend") {
      const resend = new Resend(config.apiKey);
      const { error } = await resend.emails.send({
        from: config.from,
        to,
        subject,
        text,
        html,
        attachments: [{ filename: pdfFilename, content: pdf }],
      });
      if (error) {
        log("error", "email.resend_failed", { error: error.message });
        return {
          ok: false,
          error: "The email provider rejected the message. Try again.",
        };
      }
      return { ok: true };
    }

    const transport = nodemailer.createTransport(config.smtpUrl);
    await transport.sendMail({
      from: config.from,
      to,
      subject,
      text,
      html,
      attachments: [{ filename: pdfFilename, content: pdf }],
    });
    return { ok: true };
  } catch (err) {
    log("error", "email.send_failed", {
      mode: config.mode,
      error: err instanceof Error ? err.message : "unknown",
    });
    return {
      ok: false,
      error: "Could not send the email. Check server configuration.",
    };
  }
}
