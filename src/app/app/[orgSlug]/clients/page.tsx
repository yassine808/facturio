import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CLIENTS_PAGE_SIZE,
  countClients,
  listClients,
} from "@/features/clients/queries";
import { button, input } from "@/features/auth/form-styles";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Client directory: search, pagination, archived hidden by default (the
 * archive-not-delete rule lives in the DB; this page just reflects it).
 */
export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string; page?: string; archived?: string }>;
}) {
  const { orgSlug } = await params;
  const { q = "", page: pageRaw = "1", archived } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();
  if (!(await getUserRole(supabase, org.id))) redirect("/app");

  const includeArchived = archived === "1";
  const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
  const filters = { orgId: org.id, search: q || undefined, includeArchived };

  const [clients, total] = await Promise.all([
    listClients(supabase, { ...filters, page }),
    countClients(supabase, filters),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));

  const pageHref = (nextPage: number): string => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (includeArchived) params.set("archived", "1");
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/app/${org.slug}/clients${qs ? `?${qs}` : ""}`;
  };

  // Toggle drops the page param: changing the result set resets to page 1.
  const toggleArchivedHref = (): string => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (!includeArchived) params.set("archived", "1");
    const qs = params.toString();
    return `/app/${org.slug}/clients${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}`} className="hover:underline">
          ← {org.name}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {total} {total === 1 ? "client" : "clients"}
            {includeArchived && " (including archived)"}
          </p>
        </div>
        <Link
          href={`/app/${org.slug}/clients/new`}
          className={`${button} !w-auto`}
        >
          New client
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className={`${input} !w-auto flex-1`}
        />
        {includeArchived && <input type="hidden" name="archived" value="1" />}
        <button type="submit" className={`${button} !w-auto`}>
          Search
        </button>
        <Link
          href={toggleArchivedHref()}
          className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {includeArchived ? "Hide archived" : "Show archived"}
        </Link>
      </form>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {q ? `No clients match “${q}”.` : "No clients yet — create the first one."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/app/${org.slug}/clients/${client.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div>
                  <p className="text-sm font-medium">
                    {client.name}
                    {client.archived_at && (
                      <span className="ml-2 text-xs text-zinc-400">archived</span>
                    )}
                  </p>
                  {client.email && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {client.email}
                    </p>
                  )}
                </div>
                <span className="text-sm text-zinc-400">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500 dark:text-zinc-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
