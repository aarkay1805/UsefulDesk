"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Phone,
  RefreshCw,
  Wallet,
  Pencil,
  Snowflake,
  Play,
  ExternalLink,
  UserCheck,
  UserPlus,
  UserRoundPlus,
  CircleCheck,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import {
  effectiveStatus,
  daysUntil,
  istToday,
  unfreezeEndDate,
} from "@/lib/memberships/expiry";
import type { FollowUp, Membership, Payment, PaymentMethod, Attendance } from "@/types";
import { REASON_LABEL } from "@/lib/memberships/follow-ups";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  MembershipStatusBadge,
  FeeStatusBadge,
  TrialBadge,
} from "./membership-status-badge";
import { RenewMembershipDialog } from "./renew-membership-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { FollowUpDialog, CompleteFollowUpDialog } from "./follow-up-dialog";
import { useAccountStaff } from "./use-account-staff";
import { CopyUpiLinkButton, useUpiConfig } from "./copy-upi-link-button";
import {
  SendReminderButton,
  type ReminderReadiness,
} from "./send-reminder-button";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank",
  other: "Other",
};

interface MemberDetailViewProps {
  membershipId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readiness: ReminderReadiness;
  /** Refetch the list after any mutation here. */
  onChanged: () => void;
  onEdit: (membership: Membership) => void;
}

export function MemberDetailView({
  membershipId,
  open,
  onOpenChange,
  readiness,
  onChanged,
  onEdit,
}: MemberDetailViewProps) {
  const supabase = createClient();
  const { defaultCurrency, user } = useAuth();

  const { nameById } = useAccountStaff();
  const upi = useUpiConfig();

  const [membership, setMembership] = useState<Membership | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [visits, setVisits] = useState<Attendance[]>([]);
  // This member's single open follow-up task (if any).
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  // Bumped to re-pull this sheet after a mutation (renew/payment/freeze/check-in).
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open || !membershipId) return;
    let cancelled = false;
    (async () => {
      // Membership first — the open follow-up is keyed by contact, which
      // we only know once the row loads.
      const { data: m } = await supabase
        .from("memberships")
        .select("*, contact:contacts(*), plan:membership_plans(*)")
        .eq("id", membershipId)
        .maybeSingle();
      if (cancelled) return;
      if (!m) {
        setMembership(null);
        return;
      }

      const [{ data: pays }, { data: atts }, { data: fu }] = await Promise.all([
        supabase
          .from("payments")
          .select("*")
          .eq("membership_id", membershipId)
          .order("paid_at", { ascending: false }),
        supabase
          .from("attendance")
          .select("*")
          .eq("membership_id", membershipId)
          .order("checked_in_at", { ascending: false })
          .limit(20),
        supabase
          .from("follow_ups")
          .select("*")
          .eq("contact_id", (m as Membership).contact_id)
          .eq("status", "open")
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setMembership(m as Membership);
      setPayments((pays as Payment[]) ?? []);
      setVisits((atts as Attendance[]) ?? []);
      setFollowUp((fu as FollowUp) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membershipId, nonce, supabase]);

  // Refetch this sheet AND tell the parent list to refresh.
  const refreshAll = useCallback(() => {
    setNonce((n) => n + 1);
    onChanged();
  }, [onChanged]);

  async function freeze() {
    if (!membership) return;
    setBusy(true);
    const { error } = await supabase
      .from("memberships")
      .update({ status: "frozen", frozen_at: istToday() })
      .eq("id", membership.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Membership frozen");
    refreshAll();
  }

  async function unfreeze() {
    if (!membership) return;
    setBusy(true);
    const newEnd = unfreezeEndDate(membership.end_date, membership.frozen_at);
    const { error } = await supabase
      .from("memberships")
      .update({ status: "active", frozen_at: null, end_date: newEnd })
      .eq("id", membership.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Membership resumed");
    refreshAll();
  }

  async function checkIn() {
    if (!membership || !user) return;
    setBusy(true);
    const { error } = await supabase.from("attendance").insert({
      account_id: membership.account_id,
      contact_id: membership.contact_id,
      membership_id: membership.id,
      user_id: user.id,
      method: "manual",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Checked in");
    refreshAll();
  }

  const eff = membership ? effectiveStatus(membership) : null;
  const days = membership ? daysUntil(membership.end_date) : 0;

  // Outstanding balance for the current period, derived from the loaded
  // ledger (payments stamped with this period's end_date). Matches the
  // membership_dues view so a partial payment shows a remaining balance.
  const collectedCurrent = membership
    ? payments
        .filter((p) => p.status === "paid" && p.period_end === membership.end_date)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    : 0;
  const balance = membership
    ? Math.max(Number(membership.fee_amount) - collectedCurrent, 0)
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {!membership || membership.id !== membershipId ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-border">
              <SheetTitle>{membership.contact?.name || "Unnamed member"}</SheetTitle>
              <SheetDescription className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {membership.contact?.phone || "No phone"}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {membership.is_trial && <TrialBadge />}
                {eff && <MembershipStatusBadge status={eff} daysToExpiry={days} />}
                {!membership.is_trial && <FeeStatusBadge status={membership.fee_status} />}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-4">
              {/* Membership summary */}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Plan</dt>
                  <dd className="font-medium text-foreground">
                    {membership.plan?.name ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Fee</dt>
                  <dd className="font-medium text-foreground">
                    {formatCurrency(membership.fee_amount, defaultCurrency)}
                    {balance > 0 && (
                      <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        ({formatCurrency(balance, defaultCurrency)} due)
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Started</dt>
                  <dd className="text-foreground">{membership.start_date}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Expires</dt>
                  <dd className="text-foreground">
                    {membership.end_date}
                    {eff === "active" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({days < 0 ? `${-days}d ago` : days === 0 ? "today" : `in ${days}d`})
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              {membership.notes && (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {membership.notes}
                </p>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {membership.is_trial ? (
                  <Button
                    onClick={() => setConvertOpen(true)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <UserPlus className="size-4" /> Convert to member
                  </Button>
                ) : (
                  <Button
                    onClick={() => setRenewOpen(true)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <RefreshCw className="size-4" /> Renew
                  </Button>
                )}
                {!membership.is_trial && (
                  <Button variant="outline" onClick={() => setPayOpen(true)}>
                    <Wallet className="size-4" /> Record payment
                  </Button>
                )}
                {!membership.is_trial && balance > 0 && (
                  <CopyUpiLinkButton
                    upi={upi}
                    amount={balance}
                    note={`${membership.plan?.name ?? "Membership"} fee`}
                    size="default"
                  />
                )}
                <Button variant="outline" onClick={checkIn} disabled={busy}>
                  <UserCheck className="size-4" /> Check in
                </Button>
                <SendReminderButton
                  membership={membership}
                  readiness={readiness}
                  onSent={() => {}}
                  size="default"
                />
                {membership.status === "frozen" ? (
                  <Button variant="outline" onClick={unfreeze} disabled={busy}>
                    <Play className="size-4" /> Resume
                  </Button>
                ) : (
                  membership.status === "active" && (
                    <Button variant="outline" onClick={freeze} disabled={busy}>
                      <Snowflake className="size-4" /> Freeze
                    </Button>
                  )
                )}
                {!followUp && (
                  <Button variant="outline" onClick={() => setAssignOpen(true)}>
                    <UserRoundPlus className="size-4" /> Assign follow-up
                  </Button>
                )}
                <Button variant="ghost" onClick={() => onEdit(membership)}>
                  <Pencil className="size-4" /> Edit
                </Button>
              </div>

              {/* Open follow-up — owner, reason, due, one-tap close */}
              {followUp && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      {REASON_LABEL[followUp.reason]} follow-up · due {followUp.due_date}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {followUp.assigned_to
                        ? `Owner: ${nameById.get(followUp.assigned_to) ?? "Teammate"}`
                        : "Unassigned"}
                      {followUp.note ? ` · ${followUp.note}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setCompleteOpen(true)}
                  >
                    <CircleCheck className="size-3.5" /> Done
                  </Button>
                </div>
              )}

              {/* Payment history */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">
                  Payment history
                </h3>
                {payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {payments.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">
                            {formatCurrency(p.amount, defaultCurrency)}
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {METHOD_LABEL[p.method]} · {p.paid_at.slice(0, 10)}
                          </span>
                        </div>
                        {p.screenshot_url && (
                          <a
                            href={p.screenshot_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="View screenshot"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recent visits */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">Recent visits</h3>
                {visits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No check-ins recorded yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {visits.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
                      >
                        <UserCheck className="size-3.5 text-emerald-700 dark:text-emerald-400" />
                        {new Date(v.checked_in_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <RenewMembershipDialog
              open={renewOpen}
              onOpenChange={setRenewOpen}
              membership={membership}
              onSaved={refreshAll}
            />
            <RenewMembershipDialog
              open={convertOpen}
              onOpenChange={setConvertOpen}
              membership={membership}
              variant="convert"
              onSaved={refreshAll}
            />
            <RecordPaymentDialog
              open={payOpen}
              onOpenChange={setPayOpen}
              membership={membership}
              onSaved={refreshAll}
            />
            <FollowUpDialog
              open={assignOpen}
              onOpenChange={setAssignOpen}
              membership={membership}
              onSaved={refreshAll}
            />
            {followUp && (
              <CompleteFollowUpDialog
                open={completeOpen}
                onOpenChange={setCompleteOpen}
                followUp={followUp}
                onSaved={refreshAll}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
