"use client";

import { ActionForm } from "@/components/action-form";
import { input } from "@/features/auth/form-styles";
import { createOrg } from "./actions";

export function CreateOrgForm() {
  return (
    <ActionForm action={createOrg} submitLabel="Create organization" pendingLabel="Creating…">
      <div>
        <label htmlFor="org-name" className="mb-1 block text-sm font-medium">
          Organization name
        </label>
        <input
          id="org-name"
          name="name"
          required
          maxLength={100}
          autoComplete="organization"
          placeholder="Acme Studio"
          className={input}
        />
      </div>
    </ActionForm>
  );
}
