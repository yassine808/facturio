import { CreateOrgForm } from "@/features/orgs/create-org-form";

/** Create an additional organization while already having one (the "+" in the switcher). */
export default function NewOrgPage() {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Create a new organization</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Each organization is its own workspace with separate members, clients,
        and invoices.
      </p>
      <div className="mt-6">
        <CreateOrgForm />
      </div>
      <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
        Got an invite link? Open it while signed in to join an existing
        organization instead.
      </p>
    </div>
  );
}
