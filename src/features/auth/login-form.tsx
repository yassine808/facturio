"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthState } from "@/features/auth/actions";
import { input, button } from "@/features/auth/form-styles";

const URL_ERRORS: Record<string, string> = {
  invalid_link: "That link is invalid or has expired. Request a new one.",
  oauth_failed: "Sign-in with that provider failed. Try again.",
};

export function LoginForm({
  next,
  urlError,
  resetDone,
}: {
  next?: string;
  urlError?: string;
  resetDone?: boolean;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, {
    ok: false,
  });

  const error = state.error ?? (urlError ? URL_ERRORS[urlError] : undefined);

  return (
    <form action={action} className="space-y-4">
      {resetDone && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Password updated — sign in with your new password.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={input}
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-300"
          >
            Forgot?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="current-password"
          className={input}
        />
      </div>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
