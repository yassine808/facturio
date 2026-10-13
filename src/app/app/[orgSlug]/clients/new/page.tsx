import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClientForm } from "@/features/clients/client-form";
import { createClient } from "@/features/clients/actions";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

/** New client: a member-level action, so any member of the org lands here. */
export default async function NewClientPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();
  if (!(await getUserRole(supabase, org.id))) redirect("/app");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}/clients`} className="hover:underline">
          ← Clients
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">New client</h1>
      <ClientForm
        action={createClient}
        orgId={org.id}
        orgSlug={org.slug}
        submitLabel="Create client"
      />
    </div>
  );
}
