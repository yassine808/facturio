"use client";

import { useActionState, type ReactNode } from "react";
import { button } from "@/features/auth/form-styles";

/**
 * The app's one client-form primitive: wraps a server action in
 * useActionState and renders pending/error/success around whatever fields
 * the caller passes as children. Hidden inputs in children are only trusted
 * as far as the action's own authorization re-check allows — RLS remains the
 * actual boundary.
 */
export type FormState = {
  ok: boolean;
  error?: string;
  message?: string;
  token?: string;
};

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  buttonClassName = button,
  className = "space-y-3",
}: {
  action: Action;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  buttonClassName?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {
    ok: false,
  });

  return (
    <form action={formAction} className={className}>
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
      {children}
      <button type="submit" disabled={pending} className={buttonClassName}>
        {pending ? (pendingLabel ?? submitLabel) : submitLabel}
      </button>
    </form>
  );
}
