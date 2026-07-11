"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Ghost,
  Loader2,
  MoonStar,
  UserRoundPlus,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { INACTIVE_DAYS } from "@/lib/memberships/stats";
import {
  partitionInactivity,
  daysSinceVisit,
} from "@/lib/memberships/inactivity";
import type { Contact, MemberActivity, Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { FollowUpDialog } from "./follow-up-dialog";

interface InactiveActionListsProps {
  /** Opens the member detail sheet (keyed by membership id). */
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

/** The follow-up dialog wants a Membership; rebuild one from the flat
 *  view row (only the fields the dialog and defaultReason read). */
function toMembership(r: MemberActivity): Membership {
  return {
    id: r.membership_id,
    account_id: r.account_id,
    contact_id: r.contact_id,
    user_id: "",
    plan_id: r.plan_id,
    start_date: r.start_date,
    end_date: r.end_date,
    status: r.status,
    fee_amount: r.fee_amount,
    fee_status: r.fee_status,
    is_trial: r.is_trial,
    created_at: "",
    updated_at: "",
    contact: { name: r.contact_name, phone: r.contact_phone } as Contact,
  } as Membership;
}

/**
 * Retention action lists — the churn-risk half of "who stopped
 * coming?". Two buckets over the member_activity view (037):
 * paid-up members gone quiet for INACTIVE_DAYS+, and members who
 * joined but never checked in. Each row hands the chase to a staff
 * owner via the follow-ups system (reason: inactive).
 */
export function InactiveActionLists({
  onSelect,
  reloadKey,
}: InactiveActionListsProps) {
  const { canSendMessages } = useAuth();
  const { fmt } = useLocale();

  const [rows, setRows] = useState<MemberActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Member being handed to a staff owner via the assign dialog.
  const [assigning, setAssigning] = useState<MemberActivity | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      // Current paying members only — expired/trial people are already
      // chased from the Renewals and Trials lists.
      const { data } = await supabase
        .from("member_activity")
        .select("*")
        .eq("status", "active")
        .eq("is_trial", false)
        .gte("end_date", fmt.today());
      if (cancelled) return;
      setRows((data as MemberActivity[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, fmt]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  const today = fmt.today();
  const { inactive, neverVisited } = partitionInactivity(rows, today);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <RetentionList
          title={`Inactive ${INACTIVE_DAYS}+ days`}
          icon={<MoonStar className="size-4 text-amber-700 dark:text-amber-400" />}
          rows={inactive}
          detail={(r) => {
            const days = daysSinceVisit(r, today);
            return `${r.plan_name ?? "—"} · last visit ${days}d ago`;
          }}
          onSelect={onSelect}
          onAssign={canSendMessages ? setAssigning : undefined}
          emptyLabel="Everyone with a visit history has been in recently."
        />
        <RetentionList
          title="Never visited"
          icon={<Ghost className="size-4 text-muted-foreground" />}
          rows={neverVisited}
          detail={(r) => `${r.plan_name ?? "—"} · member since ${r.start_date}`}
          onSelect={onSelect}
          onAssign={canSendMessages ? setAssigning : undefined}
          emptyLabel="Every member has checked in at least once."
        />
      </div>

      {assigning && (
        <FollowUpDialog
          open={!!assigning}
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          membership={toMembership(assigning)}
          initialReason="inactive"
          onSaved={() => setAssigning(null)}
        />
      )}
    </>
  );
}

function RetentionList({
  title,
  icon,
  rows,
  detail,
  onSelect,
  onAssign,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: MemberActivity[];
  detail: (r: MemberActivity) => string;
  onSelect: (membershipId: string) => void;
  /** Present for agent+ — opens the assign-follow-up dialog. */
  onAssign?: (r: MemberActivity) => void;
  emptyLabel: string;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {icon}
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-500/70" />
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li
              key={r.membership_id}
              className="cursor-pointer px-3 py-2.5 transition-colors hover:bg-muted/50"
              onClick={() => onSelect(r.membership_id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {r.contact_name || r.contact_phone || "Unnamed"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {detail(r)}
                  </p>
                </div>
                {onAssign && (
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button size="sm" variant="ghost" onClick={() => onAssign(r)}>
                      <UserRoundPlus className="size-3.5" /> Assign
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
