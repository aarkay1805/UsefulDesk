"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Clock,
  CircleAlert,
  CheckCircle2,
  Loader2,
  UserPlus,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { daysUntil } from "@/lib/memberships/expiry";
import {
  partitionTrials,
  type TrialBucket,
  type PartitionedTrials,
} from "@/lib/memberships/trials";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import { TrialBadge } from "./membership-status-badge";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";
import { RenewMembershipDialog } from "./renew-membership-dialog";

interface TrialActionListsProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

const SELECT = "*, contact:contacts(*), plan:membership_plans(*)";

const BUCKET_META: Record<
  TrialBucket,
  { label: string; icon: React.ReactNode; empty: string }
> = {
  ending_today: {
    label: "Ending today",
    icon: <CalendarClock className="size-4 text-amber-400" />,
    empty: "No trials ending today.",
  },
  ending_soon: {
    label: "Ending this week",
    icon: <Clock className="size-4 text-sky-400" />,
    empty: "No trials ending this week.",
  },
  expired_unconverted: {
    label: "Expired — not converted",
    icon: <CircleAlert className="size-4 text-red-400" />,
    empty: "No lapsed trials to win back.",
  },
};

const BUCKET_ORDER: TrialBucket[] = [
  "ending_today",
  "ending_soon",
  "expired_unconverted",
];

export function TrialActionLists({
  readiness,
  onSelect,
  reloadKey,
}: TrialActionListsProps) {
  const [trials, setTrials] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a convert/reminder to re-pull the lists.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // The trial currently being converted (drives the shared dialog).
  const [converting, setConverting] = useState<Membership | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      // Unconverted, non-cancelled trials only — the win-back tail is
      // "expired AND never converted", so converted rows drop out here.
      const { data } = await supabase
        .from("memberships")
        .select(SELECT)
        .eq("is_trial", true)
        .is("converted_at", null)
        .neq("status", "cancelled")
        .order("end_date", { ascending: true });
      if (cancelled) return;
      setTrials((data as Membership[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  const buckets: PartitionedTrials = useMemo(
    () => partitionTrials(trials),
    [trials],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading trials…
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {BUCKET_ORDER.map((key) => (
          <TrialList
            key={key}
            meta={BUCKET_META[key]}
            rows={buckets[key]}
            readiness={readiness}
            onSelect={onSelect}
            onConvert={setConverting}
            onChanged={reload}
          />
        ))}
      </div>

      {converting && (
        <RenewMembershipDialog
          open={!!converting}
          onOpenChange={(o) => !o && setConverting(null)}
          membership={converting}
          variant="convert"
          onSaved={() => {
            setConverting(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function TrialList({
  meta,
  rows,
  readiness,
  onSelect,
  onConvert,
  onChanged,
}: {
  meta: { label: string; icon: React.ReactNode; empty: string };
  rows: Membership[];
  readiness: ReminderReadiness;
  onSelect: (id: string) => void;
  onConvert: (m: Membership) => void;
  onChanged: () => void;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {meta.icon}
        <h3 className="text-sm font-medium text-foreground">{meta.label}</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCircle2 className="size-6 text-emerald-500/70" />
          <p className="text-xs text-muted-foreground">{meta.empty}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((m) => {
            const days = daysUntil(m.end_date);
            const when =
              days < 0
                ? `ended ${m.end_date} (${-days}d ago)`
                : days === 0
                  ? `ends today`
                  : `ends ${m.end_date} (in ${days}d)`;
            return (
              <li
                key={m.id}
                className="cursor-pointer px-3 py-2.5 transition-colors hover:bg-muted/50"
                onClick={() => onSelect(m.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.contact?.name || m.contact?.phone || "Unnamed"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.plan?.name ?? "Trial pass"} · {when}
                    </p>
                  </div>
                  <TrialBadge />
                </div>
                <div
                  className="mt-2 flex justify-end gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SendReminderButton
                    membership={m}
                    readiness={readiness}
                    onSent={onChanged}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onConvert(m)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <UserPlus className="size-3.5" /> Convert
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
