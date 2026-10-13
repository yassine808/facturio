"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useActionState } from "react";
import { AuthCard } from "@/components/auth-card";
import { createClient } from "@/lib/supabase/client";
import { resetPassword, type AuthState } from "@/features/auth/actions";
import { input, button } from "@/features/auth/form-styles";

type Exchange = "pending" | "ready" | "invalid";

/**
 * Recovery link lands here with ?code= (PKCE). We exchange it for a session
 * in the browser (browser client owns document.cookie), then the form's
 * server action can call updateUser({ password }).
 */
export default function ResetPasswordPage() {
  const [exchange, setExchange] = useState<Exchange>("pending");
  const [state, action, pending] = useActionState<AuthState, FormData>(resetPassword, {
    ok: false,
  });

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      // No code: only valid if a session already exists (page reloaded).
      createClient()
        .auth.getUser()
        .then(({ data }) => setExchange(data.user ? "ready" : "invalid"));
      return;
    }
    createClient()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => setExchange(error ? "invalid" : "ready"));
  }, []);

  if (exchange === "pending") {
    return (
      <AuthCard title="Reset password">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking your link…</p>
      </AuthCard>
    );
  }

  if (exchange === "invalid") {
    return (
      <AuthCard
        title="Reset password"
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-zinc-800 underline dark:text-zinc-200"
          >
            Request a new link
          </Link>
        }
      >
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          This link is invalid or has expired.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle="It must be at least 8 characters.">
      <form action={action} className="space-y-4">
        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={input}
          />
        </div>
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthCard>
  );
}
