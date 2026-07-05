"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  Loader2,
  UserRound,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  bucketFollowUps,
  REASON_LABEL,
} from "@/lib/memberships/follow-ups";
import type { FollowUp } from "@/types";
import { Button } from "@/components/ui/button";
import { CompleteFollowUpDialog } from "./follow-up-dialog";
import { useAccountStaff } from "./use-account-staff";

interface FollowUpListsProps {
  /** Opens the member detail sheet (keyed by membership id). */
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

/**
 * The "follow-ups pending" action lists — overdue / due today /
 * upcoming, each row carrying its owner, reason, and a one-tap
 * complete-with-outcome. This is the accountability half of the
 * renewal wedge: the renewal lists say who to chase, these say who
 * on staff owns each chase and what happened.
 */
export function FollowUpLists({ onSelect, reloadKey }: FollowUpListsProps) {
  const { nameById } = useAccountStaff();

  const [rows, setRows] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a complete/cancel to re-pull the buckets.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const [completing, setCompleting] = useState<FollowUp | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("*, contact:contacts(*)")
        .eq("status", "open")
        .order("due_date", { ascending: true });
      if (cancelled) return;
      setRows((data as FollowUp[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading follow-ups…
      </div>
    );
  }

  const buckets = bucketFollowUps(rows);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <TaskList
          title="Overdue"
          icon={<CircleAlert className="size-4 text-red-400" />}
          rows={buckets.overdue}
          nameById={nameById}
          onSelect={onSelect}
          onComplete={setCompleting}
          emptyLabel="Nothing overdue."
        />
        <TaskList
          title="Due today"
          icon={<CalendarClock className="size-4 text-amber-400" />}
          rows={buckets.dueToday}
          nameById={nameById}
          onSelect={onSelect}
          onComplete={setCompleting}
          emptyLabel="Nothing due today."
        />
        <TaskList
          title="Upcoming"
          icon={<CalendarDays className="size-4 text-muted-foreground" />}
          rows={buckets.upcoming}
          nameById={nameById}
          onSelect={onSelect}
          onComplete={setCompleting}
          emptyLabel="No upcoming follow-ups."
        />
      </div>

      {completing && (
        <CompleteFollowUpDialog
          open={!!completing}
          onOpenChange={(o) => {
            if (!o) setCompleting(null);
          }}
          followUp={completing}
          onSaved={reload}
        />
      )}
    </>
  );
}

function TaskList({
  title,
  icon,
  rows,
  nameById,
  onSelect,
  onComplete,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: FollowUp[];
  nameById: Map<string, string>;
  onSelect: (membershipId: string) => void;
  onComplete: (f: FollowUp) => void;
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
          <CheckCircle2 className="size-6 text-emerald-500/70" />
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((f) => {
            const owner = f.assigned_to
              ? (nameById.get(f.assigned_to) ?? "Teammate")
              : "Unassigned";
            return (
              <li
                key={f.id}
                className={
                  f.membership_id
                    ? "cursor-pointer px-3 py-2.5 transition-colors hover:bg-muted/50"
                    : "px-3 py-2.5"
                }
                onClick={f.membership_id ? () => onSelect(f.membership_id!) : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {f.contact?.name || f.contact?.phone || "Unnamed"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {REASON_LABEL[f.reason]} · due {f.due_date}
                    </p>
                    {f.note && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                        {f.note}
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      f.assigned_to
                        ? "bg-muted text-muted-foreground"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    <UserRound className="size-3" />
                    {owner}
                  </span>
                </div>
                <div
                  className="mt-2 flex justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onComplete(f)}
                  >
                    <CircleCheck className="size-3.5" /> Done
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
