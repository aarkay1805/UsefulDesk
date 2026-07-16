"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/errors";
import { RENEWAL_TEMPLATE_NAME } from "@/lib/memberships/renewal-reminders";
import {
  deriveOnboardingSteps,
  ONBOARDING_STEP_COUNT,
  type OnboardingRawStatus,
  type OnboardingStep,
} from "@/lib/onboarding/steps";

interface OnboardingStatusValue {
  /**
   * True when the Get Started experience applies to this session:
   * profile resolved, caller is admin+, and the account hasn't
   * dismissed onboarding. Sidebar/nav gate on this.
   */
  active: boolean;
  /** True while the completion queries are in flight (only when active). */
  loading: boolean;
  steps: OnboardingStep[];
  completedCount: number;
  total: number;
  allDone: boolean;
  /** First incomplete step — the "do this next" suggestion. */
  recommended: OnboardingStep | null;
  /** Re-run the completion checks (e.g. when the page regains focus). */
  refresh: () => void;
  /** Persist dismissal on the account so onboarding hides everywhere. */
  dismiss: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingStatusValue | null>(null);

/**
 * Fetches the Get Started completion signals once and shares them with
 * the sidebar and the /get-started page (single fetch, no duplicates).
 * Short-circuits entirely — zero queries — for non-admins and for
 * accounts that already dismissed onboarding, so mature accounts pay
 * nothing for this. Once every step is detected complete it stamps
 * `accounts.onboarding_dismissed_at` so the checks never run again.
 */
export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accountId, account, profileLoading, canEditSettings, refreshProfile } =
    useAuth();
  const pathname = usePathname();
  // Entering/leaving /get-started flips this, re-running the effect —
  // returning from a completed step always shows fresh state without
  // the page needing a setState-in-effect refresh call.
  const onGetStartedPage = pathname.startsWith("/get-started");
  const [raw, setRaw] = useState<OnboardingRawStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Guards the auto-dismiss write so a re-render can't fire it twice.
  const persistedRef = useRef(false);

  const active =
    !profileLoading &&
    canEditSettings &&
    !!accountId &&
    account?.onboarding_dismissed_at == null;

  useEffect(() => {
    if (!active || !accountId) return;
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      // allSettled: one failed signal must not blank the checklist. A
      // failed fetch derives as "not done" (steps.ts treats nulls as
      // incomplete), so we can never auto-dismiss off missing data.
      const [config, template, plans, memberships, payments, team, invites] =
        await Promise.allSettled([
          supabase.from("whatsapp_config").select("status").maybeSingle(),
          supabase
            .from("message_templates")
            .select("id", { count: "exact", head: true })
            .eq("name", RENEWAL_TEMPLATE_NAME)
            .eq("status", "APPROVED"),
          supabase
            .from("membership_plans")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("memberships")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("payments")
            .select("id", { count: "exact", head: true })
            .eq("status", "paid"),
          fetch("/api/account/members", { cache: "no-store" }).then((r) =>
            r.json(),
          ),
          fetch("/api/account/invitations", { cache: "no-store" }).then((r) =>
            r.json(),
          ),
        ]);
      if (cancelled) return;

      const count = (res: PromiseSettledResult<{ count: number | null }>) =>
        res.status === "fulfilled" ? (res.value.count ?? 0) : 0;

      setRaw({
        whatsappConnected:
          config.status === "fulfilled" &&
          config.value.data?.status === "connected",
        templateApproved:
          template.status === "fulfilled" && (template.value.count ?? 0) > 0,
        planCount: count(plans),
        membershipCount: count(memberships),
        paidPaymentCount: count(payments),
        teamSize:
          team.status === "fulfilled" && Array.isArray(team.value?.members)
            ? team.value.members.length
            : null,
        pendingInvites:
          invites.status === "fulfilled" &&
          Array.isArray(invites.value?.invitations)
            ? invites.value.invitations.length
            : null,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, accountId, nonce, onGetStartedPage]);

  const derived = useMemo(
    () =>
      raw
        ? deriveOnboardingSteps(raw)
        : {
            steps: [] as OnboardingStep[],
            completedCount: 0,
            total: ONBOARDING_STEP_COUNT,
            allDone: false,
            recommended: null,
          },
    [raw],
  );

  const persistDismissal = useCallback(async () => {
    if (!accountId) return false;
    const supabase = createClient();
    // .select('id') — an RLS-blocked update fails silently with zero
    // rows; an empty result means the write did NOT land.
    const { data, error } = await supabase
      .from("accounts")
      .update({ onboarding_dismissed_at: new Date().toISOString() })
      .eq("id", accountId)
      .select("id");
    if (error || !data?.length) return false;
    await refreshProfile();
    return true;
  }, [accountId, refreshProfile]);

  // Auto-hide: the moment every step is affirmatively complete, stamp
  // the dismissal so the sidebar item disappears and future sessions
  // skip the status queries entirely.
  useEffect(() => {
    if (!active || loading || !derived.allDone || persistedRef.current) return;
    persistedRef.current = true;
    void persistDismissal().then((ok) => {
      // Leave the guard set on success; on failure allow a later retry.
      if (!ok) persistedRef.current = false;
    });
  }, [active, loading, derived.allDone, persistDismissal]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const dismiss = useCallback(async () => {
    try {
      const ok = await persistDismissal();
      if (!ok) throw new Error("You don't have permission to hide this page.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't hide the Get Started page."));
    }
  }, [persistDismissal]);

  const value = useMemo<OnboardingStatusValue>(
    () => ({
      active,
      loading: active && loading,
      steps: derived.steps,
      completedCount: derived.completedCount,
      total: derived.total,
      allDone: derived.allDone,
      recommended: derived.recommended,
      refresh,
      dismiss,
    }),
    [active, loading, derived, refresh, dismiss],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboardingStatus(): OnboardingStatusValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error(
      "useOnboardingStatus must be used within an OnboardingProvider",
    );
  }
  return ctx;
}
