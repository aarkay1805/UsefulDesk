"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CircleAlert, Wallet, CheckCircle2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { istToday, istAddDays, daysUntil, effectiveStatus } from "@/lib/memberships/expiry";
import type { Membership } from "@/types";
import { MembershipStatusBadge, FeeStatusBadge } from "./membership-status-badge";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";

interface RenewalActionListsProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

const SELECT = "*, contact:contacts(*), plan:membership_plans(*)";

export function RenewalActionLists({
  readiness,
  onSelect,
  reloadKey,
}: RenewalActionListsProps) {
  const [expiring, setExpiring] = useState<Membership[]>([]);
  const [expired, setExpired] = useState<Membership[]>([]);
  const [due, setDue] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a reminder send to re-pull the buckets.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = istToday();
      const in7 = istAddDays(today, 7);

      const [expiringRes, expiredRes, dueRes] = await Promise.all([
        supabase
          .from("memberships")
          .select(SELECT)
          .eq("is_trial", false)
          .eq("status", "active")
          .gte("end_date", today)
          .lte("end_date", in7)
          .order("end_date", { ascending: true }),
        supabase
          .from("memberships")
          .select(SELECT)
          .eq("is_trial", false)
          .eq("status", "active")
          .lt("end_date", today)
          .order("end_date", { ascending: true }),
        supabase
          .from("memberships")
          .select(SELECT)
          .eq("is_trial", false)
          .eq("fee_status", "due")
          .neq("status", "cancelled")
          .order("end_date", { ascending: true }),
      ]);
      if (cancelled) return;

      setExpiring((expiringRes.data as Membership[]) ?? []);
      setExpired((expiredRes.data as Membership[]) ?? []);
      setDue((dueRes.data as Membership[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading renewals…
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ActionList
        title="Expiring in 7 days"
        icon={<CalendarClock className="size-4 text-amber-400" />}
        rows={expiring}
        readiness={readiness}
        onSelect={onSelect}
        onChanged={reload}
        emptyLabel="No memberships expiring soon."
      />
      <ActionList
        title="Expired"
        icon={<CircleAlert className="size-4 text-red-400" />}
        rows={expired}
        readiness={readiness}
        onSelect={onSelect}
        onChanged={reload}
        emptyLabel="No expired memberships."
      />
      <ActionList
        title="Payment due"
        icon={<Wallet className="size-4 text-amber-400" />}
        rows={due}
        readiness={readiness}
        onSelect={onSelect}
        onChanged={reload}
        emptyLabel="No pending fees."
      />
    </div>
  );
}

function ActionList({
  title,
  icon,
  rows,
  readiness,
  onSelect,
  onChanged,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Membership[];
  readiness: ReminderReadiness;
  onSelect: (id: string) => void;
  onChanged: () => void;
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
          {rows.map((m) => {
            const eff = effectiveStatus(m);
            const days = daysUntil(m.end_date);
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
                      {m.plan?.name ?? "—"} · exp {m.end_date}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MembershipStatusBadge status={eff} daysToExpiry={days} />
                    <FeeStatusBadge status={m.fee_status} />
                  </div>
                </div>
                <div
                  className="mt-2 flex justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SendReminderButton
                    membership={m}
                    readiness={readiness}
                    onSent={onChanged}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
