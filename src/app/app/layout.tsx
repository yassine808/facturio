import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/features/auth/actions";
import { listOrgsForUser } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated app shell. getUser() = defense in depth (proxy also gates).
 * The org switcher renders every org the caller is a member of — RLS is what
 * makes that list trustworthy; there is no client-side filtering anywhere.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug?: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const orgs = await listOrgsForUser(supabase);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/app" className="shrink-0 text-sm font-semibold tracking-tight">
            Facturio
          </Link>
          {orgs.length > 0 && (
            <nav aria-label="Organizations" className="flex min-w-0 items-center gap-1">
              {orgs.map((org) => (
                <Link
                  key={org.id}
                  href={`/app/${org.slug}`}
                  aria-current={org.slug === orgSlug ? "page" : undefined}
                  className={
                    org.slug === orgSlug
                      ? "truncate rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "truncate rounded-md px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }
                >
                  {org.name}
                </Link>
              ))}
              <Link
                href="/app/new"
                aria-label="Create a new organization"
                title="Create a new organization"
                className="rounded-md px-2.5 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                +
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* ponytail: no avatar library — email proves who is signed in */}
          <span className="hidden text-sm text-zinc-500 dark:text-zinc-400 sm:inline">
            {user.email}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
