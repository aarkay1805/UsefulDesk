"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  Check,
  ClipboardList,
  Inbox,
  Mail,
  Phone,
  UserRoundSearch,
} from "lucide-react";
import { daysBetween } from "@/lib/memberships/expiry";
import { useCan } from "@/hooks/use-can";
import { useLocale } from "@/hooks/use-locale";
import { useAccountStaff } from "@/components/members/use-account-staff";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Skeleton } from "./skeleton";

// Today's lead actions — the PRD's "smart queue": not a dashboard to
// admire but a work list to clear. Two queues:
//   1. Follow-ups due — open tasks due today or overdue (mark done here).
//   2. Waiting for first contact — leads still in "New" after 48h.
// Both deep-link into /leads for the full record.

const STALE_HOURS = 48;
const LIST_LIMIT = 8;

interface DueFollowUp {
  id: string;
  contact_id: string;
  task_type: string;
  due_date: string;
  assigned_to: string | null;
  note: string | null;
  contact: { name: string | null; phone: string | null } | null;
  /** Days overdue vs IST today — computed at fetch time (render stays pure). */
  overdueDays: number;
}

interface StaleLead {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
  /** Whole days since capture — computed at fetch time (render stays pure). */
  waitingDays: number;
}

const TASK_ICON: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  todo: ClipboardList,
};

export function LeadActionLists() {
  const canEdit = useCan("send-messages");
  const { fmt } = useLocale();
  const { nameById, avatarById } = useAccountStaff();

  const [followUps, setFollowUps] = useState<DueFollowUp[] | null>(null);
  const [dueTotal, setDueTotal] = useState(0);
  const [staleLeads, setStaleLeads] = useState<StaleLead[] | null>(null);
  const [staleTotal, setStaleTotal] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [completing, setCompleting] = useState<string | null>(null);

  useEffect(() => {
    void nonce; // manual refetch trigger — bump to reload
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = fmt.today();
      const staleCutoff = new Date(
        Date.now() - STALE_HOURS * 60 * 60 * 1000,
      ).toISOString();

      const [dueRes, staleRes] = await Promise.all([
        supabase
          .from("follow_ups")
          .select(
            "id, contact_id, task_type, due_date, assigned_to, note, contact:contacts(name, phone)",
            { count: "exact" },
          )
          .eq("status", "open")
          .lte("due_date", today)
          .order("due_date", { ascending: true })
          .limit(LIST_LIMIT),
        supabase
          .from("contacts")
          .select("id, name, phone, created_at, memberships!left(id)", {
            count: "exact",
          })
          .is("memberships", null)
          .is("lead_status", null)
          .lt("created_at", staleCutoff)
          .order("created_at", { ascending: true })
          .limit(LIST_LIMIT),
      ]);

      if (cancelled) return;
      const now = Date.now();
      type DueRow = Omit<DueFollowUp, "overdueDays">;
      type StaleRow = Omit<StaleLead, "waitingDays">;
      setFollowUps(
        ((dueRes.data ?? []) as unknown as DueRow[]).map((f) => ({
          ...f,
          overdueDays: daysBetween(f.due_date, today),
        })),
      );
      setDueTotal(dueRes.count ?? 0);
      setStaleLeads(
        ((staleRes.data ?? []) as unknown as StaleRow[]).map((l) => ({
          ...l,
          waitingDays: Math.max(
            1,
            Math.floor(
              (now - new Date(l.created_at).getTime()) / (24 * 60 * 60 * 1000),
            ),
          ),
        })),
      );
      setStaleTotal(staleRes.count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, fmt]);

  const markDone = useCallback(
    async (id: string) => {
      setCompleting(id);
      const supabase = createClient();
      // RLS-blocked updates return no error and zero rows — chain
      // .select and treat an empty result as failure (repo rule).
      const { data, error } = await supabase
        .from("follow_ups")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      setCompleting(null);
      if (error || !data || data.length === 0) {
        toast.error("Could not complete the task");
        return;
      }
      toast.success("Task completed");
      setNonce((n) => n + 1);
    },
    [],
  );

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Today&apos;s lead actions
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Follow-ups to clear and new leads still waiting for a first touch
          </p>
        </div>
        <Link
          href="/leads"
          className="text-xs font-medium text-primary-text hover:text-primary-text/80"
        >
          Open Leads →
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
        {/* Queue 1 — follow-ups due */}
        <div>
          <p className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Follow-ups due</span>
            {dueTotal > 0 && (
              <span className="tabular-nums">
                {dueTotal > LIST_LIMIT ? `${LIST_LIMIT} of ${dueTotal}` : dueTotal}
              </span>
            )}
          </p>
          {followUps === null ? (
            <ListSkeleton />
          ) : followUps.length === 0 ? (
            <QueueEmpty icon={Inbox} text="Nothing due — queue is clear." />
          ) : (
            <ul className="space-y-1.5">
              {followUps.map((f) => {
                const Icon = TASK_ICON[f.task_type] ?? ClipboardList;
                const overdueDays = f.overdueDays;
                const who = f.contact?.name?.trim() || f.contact?.phone || "Lead";
                const assignee = f.assigned_to
                  ? nameById.get(f.assigned_to) ?? "Teammate"
                  : null;
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2"
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {who}
                    </span>
                    {assignee && (
                      <UserAvatar
                        name={assignee}
                        src={f.assigned_to ? avatarById.get(f.assigned_to) : null}
                        className="size-5 shrink-0"
                        fallbackClassName="text-[10px]"
                      />
                    )}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        overdueDays > 0
                          ? "bg-red-500/10 text-red-700 dark:text-red-400"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      {overdueDays > 0 ? `Overdue ${overdueDays}d` : "Today"}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => markDone(f.id)}
                        disabled={completing === f.id}
                        aria-label="Mark done"
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Queue 2 — new leads waiting on first contact */}
        <div>
          <p className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Waiting for first contact ({STALE_HOURS}h+)</span>
            {staleTotal > 0 && (
              <span className="tabular-nums">
                {staleTotal > LIST_LIMIT
                  ? `${LIST_LIMIT} of ${staleTotal}`
                  : staleTotal}
              </span>
            )}
          </p>
          {staleLeads === null ? (
            <ListSkeleton />
          ) : staleLeads.length === 0 ? (
            <QueueEmpty
              icon={UserRoundSearch}
              text="No new leads waiting — good response time."
            />
          ) : (
            <ul className="space-y-1.5">
              {staleLeads.map((l) => {
                const waitingDays = l.waitingDays;
                return (
                  <li key={l.id}>
                    <Link
                      href={`/leads?search=${encodeURIComponent(l.phone)}`}
                      className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {l.name?.trim() || l.phone}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {l.phone}
                      </span>
                      <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                        waiting {waitingDays}d
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function QueueEmpty({
  icon: Icon,
  text,
}: {
  icon: typeof Inbox;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
      <Icon className="size-4 shrink-0" />
      {text}
    </div>
  );
}
