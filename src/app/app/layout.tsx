import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/features/auth/actions";
import { createClient } from "@/lib/supabase/server";

/** Authenticated app shell. getUser() = defense in depth (proxy also gates). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <span className="text-sm font-semibold tracking-tight">Facturio</span>
        <div className="flex items-center gap-4">
          {/* ponytail: no avatar library — email proves who is signed in */}
          <span className="hidden text-sm text-zinc-500 sm:inline">{user.email}</span>
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
