import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArchiveClientControl, ClientForm } from "@/features/clients/client-form";
import { getClient } from "@/features/clients/queries";
import { updateClient } from "@/features/clients/actions";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/** Edit + archive/restore for one client. */
export default async function EditClientPage({
  params,
}: {
  params: Promise<{ orgSlug: string; clientId: string }>;
}) {
  const { orgSlug, clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();
  if (!(await getUserRole(supabase, org.id))) redirect("/app");

  // RLS-scoped: a client of another org 404s exactly like a deleted one.
  const client = await getClient(supabase, org.id, clientId);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}/clients`} className="hover:underline">
          ← Clients
        </Link>
      </nav>

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        <ArchiveClientControl orgSlug={org.slug} client={client} />
      </div>

      {client.archived_at && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This client is archived. Existing invoices are untouched; restore it
          to keep working with it.
        </p>
      )}

      <ClientForm
        action={updateClient}
        orgId={org.id}
        orgSlug={org.slug}
        initial={client}
        submitLabel="Save changes"
      />
    </div>
  );
}
