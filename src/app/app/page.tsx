import { redirect } from "next/navigation";
import { CreateOrgForm } from "@/features/orgs/create-org-form";
import { listOrgsForUser } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Entry point of the app. Users with organizations go to their first (oldest)
 * one — the switcher in the header handles the rest. Users without any get
 * the real onboarding screen right here.
 */
export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgs = await listOrgsForUser(supabase);
  if (orgs.length > 0) redirect(`/app/${orgs[0].slug}`);

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Create your organization</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        An organization is your workspace: you invite teammates, then manage
        clients and invoices inside it.
      </p>
      <div className="mt-6">
        <CreateOrgForm />
      </div>
      <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
        Got an invite link? Open it while signed in to join an existing
        organization.
      </p>
    </div>
  );
}
