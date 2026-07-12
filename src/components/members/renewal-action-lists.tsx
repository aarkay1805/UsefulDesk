"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CircleAlert,
  CheckCircle2,
  Loader2,
  RefreshCw,
  UserRoundPlus,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import {
  istAddDays,
  daysUntil,
  effectiveStatus,
} from "@/lib/memberships/expiry";
import type { Membership } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MembershipStatusBadge, FeeStatusBadge } from "./membership-status-badge";
import { MemberIdentity } from "./member-identity";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";
import { FollowUpDialog } from "./follow-up-dialog";
import { RenewMembershipDialog } from "./renew-membership-dialog";

interface RenewalActionListsProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

const SELECT = "*, contact:contacts(*), plan:membership_plans(*)";

// How far back the Expired table looks. `value` doubles as the label —
// ui/Select's SelectValue echoes the raw value, so the value must be the
// display string for the trigger to read "Last 30 days" not "30".
const EXPIRED_WINDOWS: { value: string; days: number | null }[] = [
  { value: "Last 30 days", days: 30 },
  { value: "Last 3 months", days: 90 },
  { value: "Last 6 months", days: 180 },
  { value: "All time", days: null },
];
const DEFAULT_EXPIRED_WINDOW = "All time";

export function RenewalActionLists({
  readiness,
  onSelect,
  reloadKey,
}: RenewalActionListsProps) {
  const { canSendMessages } = useAuth();
  const { fmt } = useLocale();

  const [expiring, setExpiring] = useState<Membership[]>([]);
  const [expired, setExpired] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a reminder/renew/assign to re-pull the buckets.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Expired lookback window (client-filtered over the full expired set so
  // switching is instant and counts stay accurate).
  const [expiredWindow, setExpiredWindow] = useState(DEFAULT_EXPIRED_WINDOW);

  // Member being handed to a staff owner via the assign dialog.
  const [assigning, setAssigning] = useState<Membership | null>(null);
  // Member being renewed via the renew dialog.
  const [renewing, setRenewing] = useState<Membership | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = fmt.today();
      const in7 = istAddDays(today, 7);

      const [expiringRes, expiredRes] = await Promise.all([
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
          // Most-recently lapsed first — the freshest chase targets.
          .order("end_date", { ascending: false }),
      ]);
      if (cancelled) return;

      // Only RECURRING plans belong in the renewal chase (062):
      // fixed-term plans expire quietly, session packs surface via
      // session counts. NULL-plan legacy rows stay (pre-062 behavior).
      const isChaseable = (m: Membership) =>
        !m.plan || m.plan.plan_type === "recurring";
      setExpiring(((expiringRes.data as Membership[]) ?? []).filter(isChaseable));
      setExpired(((expiredRes.data as Membership[]) ?? []).filter(isChaseable));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce, fmt]);

  const today = fmt.today();

  // Apply the lookback window to the expired set.
  const expiredFiltered = useMemo(() => {
    const win = EXPIRED_WINDOWS.find((w) => w.value === expiredWindow);
    if (!win?.days) return expired;
    const cutoff = istAddDays(today, -win.days);
    // ISO date strings compare lexically = chronologically.
    return expired.filter((m) => m.end_date >= cutoff);
  }, [expired, expiredWindow, today]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading renewals…
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <RenewalTable
          title="Expiring in 7 days"
          icon={
            <CalendarClock className="size-4 text-amber-700 dark:text-amber-400" />
          }
          rows={expiring}
          readiness={readiness}
          onSelect={onSelect}
          onChanged={reload}
          onAssign={canSendMessages ? setAssigning : undefined}
          onRenew={setRenewing}
          emptyLabel="No memberships expiring soon."
        />

        <RenewalTable
          title="Expired"
          icon={
            <CircleAlert className="size-4 text-red-700 dark:text-red-400" />
          }
          rows={expiredFiltered}
          readiness={readiness}
          onSelect={onSelect}
          onChanged={reload}
          onAssign={canSendMessages ? setAssigning : undefined}
          onRenew={setRenewing}
          emptyLabel="No expired memberships in this window."
          headerAction={
            <Select
              value={expiredWindow}
              onValueChange={(v) => setExpiredWindow(v ?? DEFAULT_EXPIRED_WINDOW)}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRED_WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      {assigning && (
        <FollowUpDialog
          open={!!assigning}
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          membership={assigning}
          onSaved={reload}
        />
      )}

      {renewing && (
        <RenewMembershipDialog
          open={!!renewing}
          onOpenChange={(o) => {
            if (!o) setRenewing(null);
          }}
          membership={renewing}
          onSaved={reload}
        />
      )}
    </>
  );
}

function RenewalTable({
  title,
  icon,
  rows,
  readiness,
  onSelect,
  onChanged,
  onAssign,
  onRenew,
  emptyLabel,
  headerAction,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Membership[];
  readiness: ReminderReadiness;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Present for agent+ — opens the assign-follow-up dialog. */
  onAssign?: (m: Membership) => void;
  onRenew: (m: Membership) => void;
  emptyLabel: string;
  /** Optional control shown on the right of the header (e.g. a filter). */
  headerAction?: React.ReactNode;
}) {
  const { fmt } = useLocale();
  const today = fmt.today();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {rows.length}
        </span>
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-500/70" />
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const eff = effectiveStatus(m, today);
                const days = daysUntil(m.end_date, today);
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(m.id)}
                  >
                    <TableCell>
                      <MemberIdentity
                        name={m.contact?.name}
                        secondary={m.contact?.phone}
                        src={m.contact?.avatar_url}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.plan?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmt.date(m.end_date)}
                    </TableCell>
                    <TableCell>
                      <MembershipStatusBadge status={eff} daysToExpiry={days} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <FeeStatusBadge status={m.fee_status} />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmt.money(m.fee_amount)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {onAssign && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onAssign(m)}
                          >
                            <UserRoundPlus className="size-3.5" /> Assign
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRenew(m)}
                        >
                          <RefreshCw className="size-3.5" /> Renew
                        </Button>
                        <SendReminderButton
                          membership={m}
                          readiness={readiness}
                          onSent={onChanged}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
