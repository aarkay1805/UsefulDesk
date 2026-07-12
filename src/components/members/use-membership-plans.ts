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
      // pricing_options ride along (062) — a plan's price/duration live
      // there now; the plan's own price/duration_days are legacy-frozen.
      const base = supabase
        .from("membership_plans")
        .select("*, pricing_options:plan_pricing_options(*)")
        .order("name", { ascending: true });
      const { data } = activeOnly ? await base.eq("is_active", true) : await base;
      if (cancelled) return;
      const rows = ((data as MembershipPlan[]) ?? []).map((p) => ({
        ...p,
        pricing_options: (p.pricing_options ?? [])
          .slice()
          .sort(
            (a, b) =>
              a.sort_order - b.sort_order ||
              a.created_at.localeCompare(b.created_at),
          ),
      }));
      setPlans(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOnly, nonce]);

  return { plans, loading, refresh };
}
