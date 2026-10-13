"use client";

import { useActionState } from "react";
import { button } from "@/features/auth/form-styles";
import { acceptInvitation } from "./actions";
import type { FormState } from "./types";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptInvitation, {
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
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Joining…" : "Accept invitation"}
      </button>
    </form>
  );
}
