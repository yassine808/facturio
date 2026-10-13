"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "./schemas";

export type AuthState = {
  ok: boolean;
  message?: string;
  error?: string;
};

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** Only same-site absolute paths ("/app", …) — blocks open redirects. */
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/app";
}

function firstError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function login(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: str(fd, "email"),
    password: str(fd, "password"),
    next: str(fd, "next") || undefined,
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Do not leak whether the account exists.
    log("warn", "auth.login_failed", { reason: error.message });
    return { ok: false, error: "Invalid email or password" };
  }

  redirect(safeNext(parsed.data.next));
}

export async function signup(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: str(fd, "email"),
    password: str(fd, "password"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    },
  });

  if (error) {
    log("warn", "auth.signup_failed", { reason: error.message });
    // Generic answer: never reveal that an email is already registered.
    return { ok: false, error: "Could not create the account. Try again." };
  }

  if (data.session) {
    // Email confirmations disabled (e.g. local stack) — straight in.
    redirect("/app");
  }

  return {
    ok: true,
    message: "Check your email to confirm your account.",
  };
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.auth.signOut();
    log("info", "auth.logout", {});
  }
  redirect("/");
}

export async function forgotPassword(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const parsed = forgotPasswordSchema.safeParse({ email: str(fd, "email") });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env().NEXT_PUBLIC_SITE_URL}/reset-password`,
  });

  if (error) log("warn", "auth.reset_email_failed", { reason: error.message });

  // Same answer whether or not the account exists (no enumeration).
  return {
    ok: true,
    message: "If an account exists for that email, a reset link was sent.",
  };
}

export async function resetPassword(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const parsed = resetPasswordSchema.safeParse({ password: str(fd, "password") });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const supabase = await createClient();
  // Requires a recovery session: the reset link must have been opened and
  // its code exchanged on /reset-password before this action runs.
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    log("warn", "auth.update_password_failed", { reason: error.message });
    return {
      ok: false,
      error: "Could not update the password. Request a new link.",
    };
  }

  redirect("/login?reset=1");
}
