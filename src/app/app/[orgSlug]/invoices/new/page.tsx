import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { button } from "@/features/auth/form-styles";
import { createInvoice } from "@/features/invoices/actions";
import { InvoiceForm } from "@/features/invoices/invoice-form";
import { listClientOptions } from "@/features/invoices/queries";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

/**
 * New invoice: creates the draft with its first line set in one action,
 * then redirects to the draft page (the editor lives there). Needs at
 * least one active client to bill.
 */
export default async function NewInvoicePage({
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

  const clients = await listClientOptions(supabase, org.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}/invoices`} className="hover:underline">
          ← Invoices
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">New invoice</h1>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You need at least one active client before you can invoice them.
          </p>
          <Link href={`/app/${org.slug}/clients/new`} className={`${button} mt-4 !w-auto mx-auto`}>
            Create a client
          </Link>
        </div>
      ) : (
        <InvoiceForm
          action={createInvoice}
          orgId={org.id}
          orgSlug={org.slug}
          clients={clients}
          submitLabel="Create draft"
        />
      )}
    </div>
  );
}
