import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Per-organization home. getOrgBySlug runs under RLS, so an org the caller
 * does not belong to resolves to null → 404, same as one that does not exist.
 */
export default async function OrgHomePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();

  // Visible to members only, so a null role means something changed under us
  // (org deleted, membership removed mid-request) — fail closed.
  const role = await getUserRole(supabase, org.id);
  if (!role) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Signed in as {role} · <span className="font-mono">/{org.slug}</span>
      </p>

      <div className="mt-6 rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Clients and invoices arrive in the next phase. This phase ships the
          tenancy layer they will sit on: organizations, members, invitations,
          and role-based access.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/app/${org.slug}/settings/members`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Manage members
        </Link>
        <Link
          href="/app/new"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          New organization
        </Link>
      </div>
    </div>
  );
}
