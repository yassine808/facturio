import { describe, expect, it } from "vitest";
import { resolveEmailConfig } from "./config";

/**
 * Transport selection matrix (ADR-0008): resend > smtp > disabled,
 * and a transport without EMAIL_FROM is disabled — a send it could
 * only fail is not a configured server.
 */

describe("resolveEmailConfig", () => {
  it("prefers resend when both transports are configured", () => {
    expect(
      resolveEmailConfig({
        RESEND_API_KEY: "re_abc",
        EMAIL_SMTP_URL: "smtp://127.0.0.1:1025",
        EMAIL_FROM: "billing@acme.test",
      }),
    ).toEqual({ mode: "resend", apiKey: "re_abc", from: "billing@acme.test" });
  });

  it("falls back to smtp (the dev / Mailpit path)", () => {
    expect(
      resolveEmailConfig({
        EMAIL_SMTP_URL: "smtp://127.0.0.1:1025",
        EMAIL_FROM: "billing@acme.test",
      }),
    ).toEqual({
      mode: "smtp",
      smtpUrl: "smtp://127.0.0.1:1025",
      from: "billing@acme.test",
    });
  });

  it("is disabled when nothing is configured", () => {
    expect(resolveEmailConfig({})).toEqual({ mode: "disabled" });
  });

  it("is disabled when a transport lacks EMAIL_FROM", () => {
    expect(resolveEmailConfig({ RESEND_API_KEY: "re_abc" })).toEqual({
      mode: "disabled",
    });
    expect(resolveEmailConfig({ EMAIL_SMTP_URL: "smtp://127.0.0.1:1025" })).toEqual({
      mode: "disabled",
    });
  });

  it("ignores whitespace-only values (a blank .env line is not config)", () => {
    expect(
      resolveEmailConfig({ RESEND_API_KEY: "  ", EMAIL_FROM: " billing@acme.test " }),
    ).toEqual({ mode: "disabled" });
    expect(
      resolveEmailConfig({ EMAIL_SMTP_URL: "smtp://127.0.0.1:1025", EMAIL_FROM: "  " }),
    ).toEqual({ mode: "disabled" });
  });
});
