"use client";

import { useActionState } from "react";
import { forgotPassword, type AuthState } from "@/features/auth/actions";
import { input, button } from "@/features/auth/form-styles";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(forgotPassword, {
    ok: false,
  });

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {state.message}
        </p>
      )}
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
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
