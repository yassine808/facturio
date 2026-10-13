import { redirect } from "next/navigation";
import { AcceptInviteForm } from "@/features/orgs/accept-invite-form";
import { inviteTokenSchema } from "@/features/orgs/schemas";
import { createClient } from "@/lib/supabase/server";

/**
 * Invite landing page. Intentionally neutral: it shows no organization name
 * or inviter before acceptance (that would leak tenant metadata to anyone
 * holding a token — and to link scanners that prefetch URLs). The mismatch
 * case surfaces when the signed-in account clicks Accept.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Preserve the invite across the auth round-trip (?next is safeNext-checked).
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const parsed = inviteTokenSchema.safeParse(token);

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">You&apos;ve been invited</h1>
        {parsed.success ? (
          <>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              You&apos;re signed in as {user.email}. Accepting joins{" "}
              <em>this account</em> to the organization — invitations cannot be
              transferred to another email.
            </p>
            <div className="mt-4">
              <AcceptInviteForm token={parsed.data} />
            </div>
          </>
        ) : (
          <p
            role="alert"
            className="mt-2 text-sm text-red-600 dark:text-red-400"
          >
            This invitation link is not valid.
          </p>
        )}
      </div>
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        Wrong account? Log out and sign in with the invited email, then open
        the link again.
      </p>
    </div>
  );
}
