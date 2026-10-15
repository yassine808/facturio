import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { openPortal, startCheckout } from "@/features/billing/actions";
import { FREE_ACTIVE_CLIENT_LIMIT, isBillingEnabled } from "@/features/billing/config";
import { getActiveClientCount, getSubscription } from "@/features/billing/queries";
import { getOrgBySlug, getUserRole } from "@/features/orgs/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Billing page: current plan, Stripe status, client usage, and the only two
 * Stripe entry points (Checkout / Portal). Everything shown here is read from
 * the local copy in `subscriptions` — the same rows the plan-limit trigger
 * enforces — so what the page says and what the database allows cannot drift.
 */
export default async function BillingPage({
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

  const [subscription, activeClients] = await Promise.all([
    getSubscription(supabase, org.id),
    getActiveClientCount(supabase, org.id),
  ]);

  const isPro = subscription?.plan === "pro";
  const atLimit = !isPro && activeClients >= FREE_ACTIVE_CLIENT_LIMIT;
  const managed = role === "owner" || role === "admin";
  const billingOn = isBillingEnabled();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-zinc-500">Plan and usage for {org.name}.</p>
      </div>

      <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-500">Current plan</p>
            <p className="text-xl font-semibold">{isPro ? "Pro" : "Free"}</p>
            {subscription?.status && !isPro && subscription.status !== "canceled" && (
              <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                Stripe status: {subscription.status}
              </p>
            )}
            {isPro && subscription?.currentPeriodEnd && (
              <p className="mt-1 text-sm text-zinc-500">
                Renews{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-GB")}
              </p>
            )}
          </div>

          {managed && billingOn ? (
            isPro ? (
              <ActionForm
                action={openPortal}
                submitLabel="Manage plan"
                pendingLabel="Opening Stripe…"
                className="inline-flex"
              >
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={org.slug} />
              </ActionForm>
            ) : (
              <ActionForm
                action={startCheckout}
                submitLabel="Upgrade to Pro"
                pendingLabel="Opening Stripe…"
                className="inline-flex"
              >
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={org.slug} />
              </ActionForm>
            )
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">Active clients</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {isPro
            ? `${activeClients} (unlimited on Pro)`
            : `${activeClients} of ${FREE_ACTIVE_CLIENT_LIMIT}`}
        </p>
        {atLimit && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Free limit reached — archive a client or upgrade to Pro to keep adding.
          </p>
        )}
      </section>

      {!billingOn && (
        <p className="text-sm text-zinc-500">
          Billing is not configured on this deployment (no Stripe secret key), so plans
          cannot be changed here. Everything else works normally.
        </p>
      )}

      <p className="text-sm text-zinc-500">
        The free plan keeps up to {FREE_ACTIVE_CLIENT_LIMIT} active clients per
        organization; Pro is unlimited. Limits are enforced by the database itself, and
        upgrading never removes existing data. Payment details are handled entirely by
        Stripe.
      </p>
    </main>
  );
}
