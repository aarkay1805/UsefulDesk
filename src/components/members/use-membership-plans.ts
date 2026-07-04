"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MembershipPlan } from "@/types";

/**
 * Load the account's membership plans (RLS scopes to the caller's
 * account). `activeOnly` (the default) hides archived plans — used by
 * the add-member / renew pickers so a retired plan can't be chosen for
 * a new period, while a detail view can pass false to still resolve the
 * name of an archived plan a member is already on.
 */
export function useMembershipPlans(activeOnly = true) {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped by refresh() to re-run the load effect after a mutation.
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const base = supabase
        .from("membership_plans")
        .select("*")
        .order("duration_days", { ascending: true });
      const { data } = activeOnly ? await base.eq("is_active", true) : await base;
      if (cancelled) return;
      setPlans((data as MembershipPlan[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOnly, nonce]);

  return { plans, loading, refresh };
}
