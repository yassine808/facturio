import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InviteForm } from "@/features/orgs/invite-form";
import { MemberRowActions, RevokeInviteButton } from "@/features/orgs/member-actions";
import {
  getOrgBySlug,
  getUserRole,
  listInvitations,
  listMembers,
} from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Members page: roster + role management + invitation inbox for one org.
 * Every affordance here mirrors a DB rule (RLS policy or owner-backstop
 * trigger); the server computes who may do what, the actions re-check, and
 * the database refuses regardless — three layers, same rules.
 */
export default async function MembersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getOrgBySlug(supabase, orgSlug);
  if (!org) notFound();

  const role = await getUserRole(supabase, org.id);
  if (!role) redirect("/app");

  const canManage = role === "owner" || role === "admin";
  const members = await listMembers(supabase, org.id);
  // RLS would return [] for a plain member anyway; skip the query outright.
  const invitations = canManage ? await listInvitations(supabase, org.id) : [];
  const pendingInvitations = invitations.filter((inv) => !inv.accepted_at);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/app/${org.slug}`} className="hover:underline">
          ← {org.name}
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {members.length} {members.length === 1 ? "person" : "people"} · your
          role: <span className="font-medium">{role}</span>
        </p>
      </div>

      <ul className="space-y-3">
        {members.map((member) => {
          const isSelf = member.user_id === user.id;
          // Mirrors memberships_select USING: admins may not touch owner rows.
          const canChangeRole = canManage && (member.role !== "owner" || role === "owner");
          const canRemove = isSelf || canChangeRole;

          return (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <div>
                <p className="text-sm font-medium">
                  {member.profiles?.display_name ?? "Member"}
                  {isSelf && <span className="ml-2 text-xs text-zinc-400">(you)</span>}
                </p>
                <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {member.role}
                </p>
              </div>
              <MemberRowActions
                orgId={org.id}
                membershipId={member.id}
                role={member.role}
                isSelf={isSelf}
                canChangeRole={canChangeRole}
                canGrantOwner={role === "owner"}
                canRemove={canRemove}
              />
            </li>
          );
        })}
      </ul>

      {canManage && (
        <section>
          <h2 className="text-lg font-semibold">Invite teammates</h2>
          <p className="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Share a link — the invited person signs in (or signs up) with that
            email to join.
          </p>
          <InviteForm orgId={org.id} />
        </section>
      )}

      {canManage && pendingInvitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Pending invitations</h2>
          <ul className="mt-3 space-y-2">
            {pendingInvitations.map((inv) => {
              const expired = new Date(inv.expires_at) <= new Date();
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div>
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {inv.role} ·{" "}
                      {expired ? (
                        <span className="text-red-600 dark:text-red-400">expired</span>
                      ) : (
                        <>expires {new Date(inv.expires_at).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  <RevokeInviteButton orgId={org.id} invitationId={inv.id} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
