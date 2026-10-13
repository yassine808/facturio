-- 0005: profiles become readable by fellow org members.
--
-- Phase 1 kept profiles strictly private; the members UI needs display names
-- of co-members. This adds a second SELECT policy (policies on the same
-- operation are OR-ed): profiles_select_own still covers yourself.
-- share_org_with is SECURITY DEFINER, so no policy recursion (ADR-0004).

create policy "profiles_select_same_org"
  on public.profiles for select
  to authenticated
  using (public.share_org_with(id));
