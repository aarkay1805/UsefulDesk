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
import { useLocale } from "@/hooks/use-locale";
import {
  bucketFollowUps,
  REASON_LABEL,
} from "@/lib/memberships/follow-ups";
import type { FollowUp } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MemberIdentity } from "./member-identity";
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
  const { nameById, avatarById } = useAccountStaff();
  const { fmt } = useLocale();

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

  const buckets = bucketFollowUps(rows, fmt.today());

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <TaskList
          title="Overdue"
          icon={<CircleAlert className="size-4 text-red-700 dark:text-red-400" />}
          rows={buckets.overdue}
          nameById={nameById}
          avatarById={avatarById}
          onSelect={onSelect}
          onComplete={setCompleting}
          emptyLabel="Nothing overdue."
        />
        <TaskList
          title="Due today"
          icon={<CalendarClock className="size-4 text-amber-700 dark:text-amber-400" />}
          rows={buckets.dueToday}
          nameById={nameById}
          avatarById={avatarById}
          onSelect={onSelect}
          onComplete={setCompleting}
          emptyLabel="Nothing due today."
        />
        <TaskList
          title="Upcoming"
          icon={<CalendarDays className="size-4 text-muted-foreground" />}
          rows={buckets.upcoming}
          nameById={nameById}
          avatarById={avatarById}
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
  avatarById,
  onSelect,
  onComplete,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: FollowUp[];
  nameById: Map<string, string>;
  avatarById: Map<string, string | null>;
  onSelect: (membershipId: string) => void;
  onComplete: (f: FollowUp) => void;
  emptyLabel: string;
}) {
  const { fmt } = useLocale();
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {icon}
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <Badge variant="neutral" className="ml-auto tabular-nums">
          {rows.length}
        </Badge>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-500/70" />
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
                  <MemberIdentity
                    name={f.contact?.name}
                    secondary={f.contact?.phone}
                    src={f.contact?.avatar_url}
                    meta={
                      <>
                        <p className="truncate text-xs text-muted-foreground">
                          {REASON_LABEL[f.reason]} · due {fmt.date(f.due_date)}
                        </p>
                        {f.note && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
                            {f.note}
                          </p>
                        )}
                      </>
                    }
                  />
                  <Badge
                    variant={f.assigned_to ? "neutral" : "danger"}
                    className="shrink-0"
                  >
                    {f.assigned_to ? (
                      <UserAvatar
                        name={owner}
                        src={avatarById.get(f.assigned_to)}
                        className="size-3.5"
                        fallbackClassName="text-[8px]"
                      />
                    ) : (
                      <UserRound className="size-3" />
                    )}
                    {owner}
                  </Badge>
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
