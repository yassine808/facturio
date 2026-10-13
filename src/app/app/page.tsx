import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Dashboard. Organizations land in Phase 2 — until then this is the real
 * empty state: a signed-in user with no organization yet.
 */
export default async function AppHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome{user.email ? `, ${user.email}` : ""}
      </h1>
      <div className="mt-6 rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You don&apos;t belong to an organization yet. Organizations are coming in the
          next phase of this project.
        </p>
      </div>
    </div>
  );
}
