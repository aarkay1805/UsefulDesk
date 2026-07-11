"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Phone,
  Mail,
  CalendarDays,
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
  MoreHorizontal,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import {
  effectiveStatus,
  daysUntil,
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
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  MembershipStatusBadge,
  FeeStatusBadge,
  TrialBadge,
} from "./membership-status-badge";
import { RenewMembershipDialog } from "./renew-membership-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { FollowUpDialog, CompleteFollowUpDialog } from "./follow-up-dialog";
import { ContactNotesThread } from "@/components/contacts/contact-notes-thread";
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

/** How many check-ins the Visits widget shows before summarising. */
const VISITS_SHOWN = 8;

interface MemberDetailViewProps {
  membershipId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readiness: ReminderReadiness;
  /** Refetch the list after any mutation here. */
  onChanged: () => void;
  onEdit: (membership: Membership) => void;
}

/** One labelled value inside the Membership widget's stat grid. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
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
  const { user } = useAuth();
  const { fmt } = useLocale();

  const { nameById, avatarById } = useAccountStaff();
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
      .update({ status: "frozen", frozen_at: fmt.today() })
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

  const today = fmt.today();
  const eff = membership ? effectiveStatus(membership, today) : null;
  const days = membership ? daysUntil(membership.end_date, today) : 0;

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
      <SheetContent
        side="right"
        // The sheet master caps side=right at sm:max-w-sm via a
        // data-variant, which beats a plain sm:max-w-* — match the
        // variant to actually widen (same trick as the contact sheet).
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-[960px]"
      >
        {!membership || membership.id !== membershipId ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Identity header — who this is + the two wedge actions
                (remind on WhatsApp, renew). Everything else lives on its
                own widget below. pr-10 clears the sheet's close button. */}
            <SheetHeader className="border-b border-border p-4 pr-10 sm:p-5 sm:pr-12">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <UserAvatar
                  name={membership.contact?.name || "?"}
                  src={membership.contact?.avatar_url}
                  className="size-14"
                  fallbackClassName="text-lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-lg">
                      {membership.contact?.name || "Unnamed member"}
                    </SheetTitle>
                    {membership.is_trial && <TrialBadge />}
                    {eff && <MembershipStatusBadge status={eff} daysToExpiry={days} />}
                    {!membership.is_trial && (
                      <FeeStatusBadge status={membership.fee_status} />
                    )}
                  </div>
                  <SheetDescription className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="flex items-center gap-1.5">
                      <Phone className="size-3.5" />
                      {membership.contact?.phone || "No phone"}
                    </span>
                    {membership.contact?.email && (
                      <span className="flex items-center gap-1.5">
                        <Mail className="size-3.5" />
                        {membership.contact.email}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      Member since {fmt.date(membership.created_at.slice(0, 10))}
                    </span>
                  </SheetDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SendReminderButton
                    membership={membership}
                    readiness={readiness}
                    onSent={() => {}}
                    size="default"
                  />
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
                </div>
              </div>
            </SheetHeader>

            {/* Modular widget grid — main column (membership, payments,
                notes) + rail (follow-up, visits). Single column below lg. */}
            <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-5">
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
                <div className="grid min-w-0 gap-4">
                  {/* Membership */}
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle>Membership</CardTitle>
                      <CardDescription>
                        {membership.plan?.name ?? "No plan"} ·{" "}
                        {fmt.money(membership.fee_amount)}
                      </CardDescription>
                      <CardAction>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Membership actions"
                              />
                            }
                          >
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(membership)}>
                              <Pencil className="size-4" /> Edit membership
                            </DropdownMenuItem>
                            {membership.status === "frozen" ? (
                              <DropdownMenuItem onClick={unfreeze} disabled={busy}>
                                <Play className="size-4" /> Resume membership
                              </DropdownMenuItem>
                            ) : (
                              membership.status === "active" && (
                                <DropdownMenuItem onClick={freeze} disabled={busy}>
                                  <Snowflake className="size-4" /> Freeze membership
                                </DropdownMenuItem>
                              )
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Stat label="Plan">{membership.plan?.name ?? "—"}</Stat>
                        <Stat label="Fee">
                          {fmt.money(membership.fee_amount)}
                          {balance > 0 && (
                            <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                              ({fmt.money(balance)} due)
                            </span>
                          )}
                        </Stat>
                        <Stat label="Started">{fmt.date(membership.start_date)}</Stat>
                        <Stat label="Expires">
                          {fmt.date(membership.end_date)}
                          {eff === "active" && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              ({days < 0 ? `${-days}d ago` : days === 0 ? "today" : `in ${days}d`})
                            </span>
                          )}
                        </Stat>
                      </dl>
                      {membership.status === "frozen" && membership.frozen_at && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Snowflake className="size-3.5" />
                          Frozen since {fmt.date(membership.frozen_at)} — the paused
                          days are added back on resume.
                        </p>
                      )}
                      {membership.notes && (
                        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                          {membership.notes}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Payments */}
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle>Payments</CardTitle>
                      <CardDescription>
                        {!membership.is_trial && balance > 0
                          ? `${fmt.money(balance)} outstanding for the current period`
                          : "Ledger for this membership"}
                      </CardDescription>
                      {!membership.is_trial && (
                        <CardAction className="flex items-center gap-2">
                          {balance > 0 && (
                            <CopyUpiLinkButton
                              upi={upi}
                              amount={balance}
                              note={`${membership.plan?.name ?? "Membership"} fee`}
                              size="sm"
                            />
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPayOpen(true)}
                          >
                            <Wallet className="size-4" /> Record payment
                          </Button>
                        </CardAction>
                      )}
                    </CardHeader>
                    <CardContent>
                      {payments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No payments recorded yet.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="text-xs">Date</TableHead>
                              <TableHead className="text-xs">Method</TableHead>
                              <TableHead className="text-xs">Note</TableHead>
                              <TableHead className="text-right text-xs">Amount</TableHead>
                              <TableHead className="w-8" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {payments.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell>{fmt.date(p.paid_at)}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {METHOD_LABEL[p.method]}
                                </TableCell>
                                <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                                  {p.note || "—"}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {fmt.money(p.amount)}
                                </TableCell>
                                <TableCell>
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
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>

                  {/* Notes — the same authored thread as the lead detail
                      sheet (a member IS a contact, so contact_notes apply
                      unchanged). onFollowUpChanged re-pulls the sheet so
                      the follow-up widget stays in sync with note-spawned
                      tasks. */}
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle>Notes</CardTitle>
                      <CardDescription>
                        Shared with the team — attach a follow-up from the composer
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ContactNotesThread
                        contactId={membership.contact_id}
                        active={open}
                        onFollowUpChanged={refreshAll}
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* Rail */}
                <div className="grid min-w-0 gap-4">
                  {/* Follow-up */}
                  <Card size="sm">
                    <CardHeader className="border-b">
                      <CardTitle>Follow-up</CardTitle>
                      <CardAction>
                        {followUp ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCompleteOpen(true)}
                          >
                            <CircleCheck className="size-3.5" /> Done
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAssignOpen(true)}
                          >
                            <UserRoundPlus className="size-3.5" /> Assign
                          </Button>
                        )}
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      {followUp ? (
                        <div className="flex flex-col gap-1.5 text-sm">
                          <p className="font-medium text-foreground">
                            {REASON_LABEL[followUp.reason]} · due{" "}
                            {fmt.date(followUp.due_date)}
                          </p>
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {followUp.assigned_to ? (
                              <>
                                <UserAvatar
                                  name={nameById.get(followUp.assigned_to) ?? "Teammate"}
                                  src={avatarById.get(followUp.assigned_to)}
                                  className="size-4 shrink-0"
                                  fallbackClassName="text-[8px]"
                                />
                                {nameById.get(followUp.assigned_to) ?? "Teammate"}
                              </>
                            ) : (
                              "Unassigned"
                            )}
                          </p>
                          {followUp.note && (
                            <p className="text-xs text-muted-foreground">{followUp.note}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No open task — assign one so this member has an owner.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Visits */}
                  <Card size="sm">
                    <CardHeader className="border-b">
                      <CardTitle>Recent visits</CardTitle>
                      <CardAction>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={checkIn}
                          disabled={busy}
                        >
                          <UserCheck className="size-3.5" /> Check in
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      {visits.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No check-ins recorded yet.
                        </p>
                      ) : (
                        <>
                          <ul className="divide-y divide-border/50">
                            {visits.slice(0, VISITS_SHOWN).map((v) => (
                              <li
                                key={v.id}
                                className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground"
                              >
                                <UserCheck className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                                {fmt.dateTime(v.checked_in_at)}
                              </li>
                            ))}
                          </ul>
                          {visits.length > VISITS_SHOWN && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              +{visits.length - VISITS_SHOWN} earlier check-ins
                            </p>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        )}

        {membership && membership.id === membershipId && (
          <>
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
