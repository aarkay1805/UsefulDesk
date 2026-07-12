"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  UserCheck,
  UserPlus,
  MoreHorizontal,
  Camera,
  Ban,
  RotateCcw,
  ChevronRight,
  Repeat,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import {
  canCorrectPayments,
  canDeleteMember,
  canManageMandates,
} from "@/lib/auth/roles";
import { effectiveStatus, daysUntil, unfreezeEndDate } from "@/lib/memberships/expiry";
import type {
  Membership,
  Payment,
  Attendance,
  MembershipPeriodInvoice,
  PaymentMandate,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  setMembershipCancellation,
  unfreezeMembership,
  isCollectiblePeriod,
} from "@/lib/memberships/periods";
import { MembershipStatusBadge, FeeStatusBadge, TrialBadge } from "./membership-status-badge";
import { InvoiceDetailDialog } from "./invoice-detail-dialog";
import { RenewMembershipDialog } from "./renew-membership-dialog";
import { AvatarEditorDialog } from "./avatar-editor-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { SetUpAutoPayDialog } from "./set-up-autopay-dialog";
import { ContactNotesThread } from "@/components/contacts/contact-notes-thread";
import { CopyUpiLinkButton, useUpiConfig } from "./copy-upi-link-button";
import { SendReminderButton, type ReminderReadiness } from "./send-reminder-button";
import { BmiCard } from "./bmi-card";
import { MemberPersonalInfo } from "./member-personal-info";
import { MemberCommunication } from "./member-communication";
import { MemberDangerZone } from "./member-danger-zone";
import { VoidPaymentDialog } from "./void-payment-dialog";

/** Jump-nav sections, in scroll order. Ids double as `#sec-<id>`. */
const SECTIONS = [
  { id: "membership", label: "Membership" },
  { id: "payments", label: "Payments" },
  { id: "notes", label: "Notes" },
  { id: "attendance", label: "Attendance" },
  { id: "communication", label: "Communication" },
  { id: "personal", label: "Personal info" },
  { id: "settings", label: "Settings" },
] as const;

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
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Section wrapper — id anchor + scroll-margin so the sticky nav
 *  doesn't overlap the heading when jumped to. */
function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={`sec-${id}`} className="min-w-0 scroll-mt-14">
      {children}
    </section>
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
  const { user, canSendMessages, accountRole } = useAuth();
  const { locale, fmt } = useLocale();
  const upi = useUpiConfig();

  const [membership, setMembership] = useState<Membership | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [visits, setVisits] = useState<Attendance[]>([]);
  const [invoices, setInvoices] = useState<MembershipPeriodInvoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  // The period to record against (arrears); null = current period.
  const [payPeriod, setPayPeriod] = useState<MembershipPeriodInvoice | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // Track the open invoice by ID and derive the object from the latest
  // fetch, so a mutation inside the modal (void) shows fresh numbers
  // after refreshAll instead of a stale snapshot.
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [autoPayOpen, setAutoPayOpen] = useState(false);
  const [mandate, setMandate] = useState<PaymentMandate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentToVoid, setPaymentToVoid] = useState<Payment | null>(null);
  // Bumped to re-pull this sheet after a mutation (renew/payment/freeze/check-in).
  const [nonce, setNonce] = useState(0);

  // Jump-nav active section (scrollspy).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>("membership");

  useEffect(() => {
    if (!open || !membershipId) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      const { data: m, error: memberError } = await supabase
        .from("memberships")
        .select("*, contact:contacts(*), plan:membership_plans(*)")
        .eq("id", membershipId)
        .maybeSingle();
      if (cancelled) return;
      if (memberError) {
        setLoadError(memberError.message);
        return;
      }
      if (!m) {
        setLoadError("Member not found or you no longer have access.");
        return;
      }

      const [paymentsResult, attendanceResult, invoicesResult, mandateResult] =
        await Promise.all([
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
            .from("membership_period_invoices")
            .select("*")
            .eq("membership_id", membershipId)
            .order("period_start", { ascending: false }),
          // The live auto-debit mandate (if any). Not load-critical — a
          // failure here just hides the auto-pay status, never blocks the
          // sheet.
          supabase
            .from("payment_mandates")
            .select("*")
            .eq("membership_id", membershipId)
            .in("status", ["pending", "active"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (cancelled) return;
      const childError = paymentsResult.error ?? attendanceResult.error ?? invoicesResult.error;
      if (childError) {
        setLoadError(childError.message);
        return;
      }
      setMembership(m as Membership);
      setPayments((paymentsResult.data as Payment[]) ?? []);
      setVisits((attendanceResult.data as Attendance[]) ?? []);
      setInvoices((invoicesResult.data as MembershipPeriodInvoice[]) ?? []);
      setMandate((mandateResult.data as PaymentMandate | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membershipId, nonce, supabase]);

  // Scrollspy — highlight whichever section sits near the top of the
  // scroll body. Re-arms once the sections mount (membership loaded).
  useEffect(() => {
    if (!membership) return;
    const root = scrollRef.current;
    if (!root) return;
    const els = SECTIONS.map((s) => document.getElementById(`sec-${s.id}`)).filter(
      (el): el is HTMLElement => el !== null,
    );
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveSection(visible[0].target.id.replace("sec-", ""));
      },
      { root, rootMargin: "-56px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [membership?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function jumpTo(id: string) {
    setActiveSection(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Refetch this sheet AND tell the parent list to refresh.
  const refreshAll = useCallback(() => {
    setNonce((n) => n + 1);
    onChanged();
  }, [onChanged]);

  async function freeze() {
    if (!membership) return;
    setBusy(true);
    // Chain .select('id') — an RLS-blocked update returns no error + zero
    // rows, so an empty result is the real failure signal.
    const { data, error } = await supabase
      .from("memberships")
      .update({ status: "frozen", frozen_at: fmt.today() })
      .eq("id", membership.id)
      .select("id");
    setBusy(false);
    if (error || !data?.length)
      return toast.error(error?.message ?? "Couldn't freeze — check your access.");
    toast.success("Membership frozen");
    refreshAll();
  }

  async function unfreeze() {
    if (!membership) return;
    setBusy(true);
    // One transaction (migration 058): membership resumes, the current
    // period follows the shifted end_date, and its payments are
    // re-stamped to the new period key — nothing can diverge midway.
    const newEnd = unfreezeEndDate(membership.end_date, membership.frozen_at);
    const { error } = await unfreezeMembership(supabase, membership.id, newEnd);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Membership resumed");
    refreshAll();
  }

  async function cancelMembership() {
    if (!membership) return;
    setBusy(true);
    // Cancel + void the current cycle's invoice atomically (058);
    // settled past cycles stay paid.
    const { error } = await setMembershipCancellation(supabase, membership.id, true);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Membership cancelled");
    refreshAll();
  }

  async function reactivate() {
    if (!membership) return;
    setBusy(true);
    const { error } = await setMembershipCancellation(supabase, membership.id, false);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Membership reactivated");
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

  // Current-cycle money comes from the invoice read model. The local
  // ledger fallback only covers pre-057 data that has no period row.
  const collectedCurrent = membership
    ? payments
        .filter((p) => p.status === "paid" && p.period_end === membership.end_date)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    : 0;
  const currentInvoice = membership
    ? (invoices.find((inv) => inv.period_end === membership.end_date) ?? null)
    : null;
  const currentFee = Number(currentInvoice?.fee_amount ?? membership?.fee_amount ?? 0);
  const currentPaid = Number(currentInvoice?.amount_paid ?? collectedCurrent);
  const balance =
    membership?.status === "cancelled" || currentInvoice?.state === "void"
      ? 0
      : Math.max(Number(currentInvoice?.balance ?? currentFee - currentPaid), 0);

  // Invoice timeline: persisted periods (past + current, real arrears),
  // newest first so Upcoming reads at the top, history descends below.
  const canCollectCurrent = membership
    ? isCollectiblePeriod(currentInvoice, membership.status)
    : false;

  const activeInvoice = activeInvoiceId
    ? (invoices.find((inv) => inv.id === activeInvoiceId) ?? null)
    : null;

  function openInvoice(inv: MembershipPeriodInvoice) {
    setActiveInvoiceId(inv.id);
    setInvoiceOpen(true);
  }
  function recordForPeriod(inv: MembershipPeriodInvoice) {
    // A payment against the current cycle uses the plain flow (null);
    // an older cycle is passed so it reconciles to the right invoice.
    setPayPeriod(inv.period_end === membership?.end_date ? null : inv);
    setPayOpen(true);
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The sheet master caps side=right at sm:max-w-sm via a
        // data-variant, which beats a plain sm:max-w-* — match the
        // variant to actually widen (same trick as the contact sheet).
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-[1200px]"
      >
        {loadError ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="border-destructive/30 bg-destructive/10 max-w-sm rounded-xl border p-4 text-center">
              <p className="text-destructive text-sm font-medium">
                Could not load this member safely
              </p>
              <p className="text-muted-foreground mt-1 text-sm">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setNonce((n) => n + 1)}
              >
                <RefreshCw className="size-3.5" /> Try again
              </Button>
            </div>
          </div>
        ) : !membership || membership.id !== membershipId ? (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Identity header — who this is + the two wedge actions
                (remind on WhatsApp, renew). pr-10 clears the close button. */}
            <SheetHeader className="p-4 pr-10 sm:p-5 sm:pr-12">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                {canSendMessages ? (
                  <button
                    type="button"
                    onClick={() => setAvatarOpen(true)}
                    aria-label="Change member photo"
                    className="group/avatar-edit relative shrink-0 rounded-full"
                  >
                    <UserAvatar
                      name={membership.contact?.name || "?"}
                      src={membership.contact?.avatar_url}
                      className="size-14"
                      fallbackClassName="text-lg"
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar-edit:opacity-100">
                      <Camera className="size-5" />
                    </span>
                  </button>
                ) : (
                  <UserAvatar
                    name={membership.contact?.name || "?"}
                    src={membership.contact?.avatar_url}
                    className="size-14"
                    fallbackClassName="text-lg"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-lg">
                      {membership.contact?.name || "Unnamed member"}
                    </SheetTitle>
                    {membership.is_trial && <TrialBadge />}
                    {eff && <MembershipStatusBadge status={eff} daysToExpiry={days} />}
                    {!membership.is_trial && membership.status !== "cancelled" && (
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

            <div ref={scrollRef} className="bg-muted/20 flex-1 overflow-y-auto">
              {/* Jump nav — reads as part of the header (white), divider
                  after the tabs; sticky under it while scrolling. */}
              <div className="border-border bg-background sticky top-0 z-10 border-b">
                <div className="[scrollbar-width:none] overflow-x-auto px-4 sm:px-5 [&::-webkit-scrollbar]:hidden">
                  <Tabs value={activeSection} onValueChange={(v) => v && jumpTo(v)}>
                    <TabsList variant="line" className="h-11">
                      {SECTIONS.map((s) => (
                        <TabsTrigger key={s.id} value={s.id} className="flex-none">
                          {s.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {/* Main column (sections) + sticky BMI rail. */}
              <div className="p-4 sm:p-5">
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
                  <div className="flex min-w-0 flex-col gap-4">
                    {/* Membership */}
                    <Section id="membership">
                      <Card>
                        <CardHeader>
                          <CardTitle>Membership</CardTitle>
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
                              <DropdownMenuContent align="end" className="min-w-52">
                                <DropdownMenuItem onClick={() => onEdit(membership)}>
                                  <Pencil className="size-4" /> Edit membership
                                </DropdownMenuItem>
                                {accountRole &&
                                  canManageMandates(accountRole) &&
                                  membership.status === "active" &&
                                  !membership.is_trial &&
                                  !mandate && (
                                    <DropdownMenuItem
                                      onClick={() => setAutoPayOpen(true)}
                                    >
                                      <Repeat className="size-4" /> Set up auto-pay
                                    </DropdownMenuItem>
                                  )}
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
                                {membership.status === "cancelled" ? (
                                  <DropdownMenuItem onClick={reactivate} disabled={busy}>
                                    <RotateCcw className="size-4" /> Reactivate membership
                                  </DropdownMenuItem>
                                ) : (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={cancelMembership}
                                      disabled={busy}
                                    >
                                      <Ban className="size-4" /> Cancel membership
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </CardAction>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Stat label="Plan">{membership.plan?.name ?? "—"}</Stat>
                            <Stat label="Fee">
                              <span className="tabular-nums">
                                {fmt.money(membership.fee_amount)}
                              </span>
                              {balance > 0 && (
                                <span className="ml-1 text-xs font-medium text-amber-700 tabular-nums dark:text-amber-400">
                                  ({fmt.money(balance)} due)
                                </span>
                              )}
                            </Stat>
                            <Stat label="Started">{fmt.date(membership.start_date)}</Stat>
                            <Stat label="Expires">
                              {fmt.date(membership.end_date)}
                              {eff === "active" && (
                                <span className="text-muted-foreground ml-1 text-xs font-normal">
                                  (
                                  {days < 0
                                    ? `${-days}d ago`
                                    : days === 0
                                      ? "today"
                                      : `in ${days}d`}
                                  )
                                </span>
                              )}
                            </Stat>
                          </dl>
                          {mandate && (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                              <Repeat className="size-3.5" />
                              {mandate.status === "active" ? (
                                <>
                                  Auto-pay on
                                  {mandate.vpa ? ` · ${mandate.vpa}` : " · UPI AutoPay"}
                                  {" — renewals collect automatically."}
                                </>
                              ) : (
                                <>Auto-pay mandate pending the member&apos;s approval.</>
                              )}
                            </p>
                          )}
                          {membership.status === "frozen" && membership.frozen_at && (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                              <Snowflake className="size-3.5" />
                              Frozen since {fmt.date(membership.frozen_at)} — the paused days are
                              added back on resume.
                            </p>
                          )}
                          {membership.notes && (
                            <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                              {membership.notes}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </Section>

                    {/* Payments */}
                    <Section id="payments">
                      <Card>
                        <CardHeader>
                          <CardTitle>Payments</CardTitle>
                          {!membership.is_trial && canCollectCurrent && (
                            <CardAction className="flex items-center gap-2">
                              <CopyUpiLinkButton
                                upi={upi}
                                amount={balance}
                                note={`${membership.plan?.name ?? "Membership"} fee`}
                                size="sm"
                              />
                              {canSendMessages && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setPayPeriod(null);
                                    setPayOpen(true);
                                  }}
                                >
                                  <Wallet className="size-4" /> Record payment
                                </Button>
                              )}
                            </CardAction>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-5">
                          {membership.is_trial ? (
                            <p className="text-muted-foreground text-sm">
                              Trials are not billed. Convert to a member to start invoicing.
                            </p>
                          ) : (
                            <>
                              {membership.status === "cancelled" && (
                                <p className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                                  This membership is cancelled. Its current billing period is not
                                  collectible.
                                </p>
                              )}

                              <div className="space-y-2">
                                {invoices.length === 0 ? (
                                  <p className="text-muted-foreground text-sm">
                                    No billing periods yet.
                                  </p>
                                ) : (
                                  <div className="border-border overflow-hidden rounded-lg border">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead className="text-xs">Period</TableHead>
                                          <TableHead className="text-right text-xs">
                                            Invoice
                                          </TableHead>
                                          <TableHead className="text-right text-xs">Paid</TableHead>
                                          <TableHead className="text-right text-xs">
                                            Balance
                                          </TableHead>
                                          <TableHead className="text-xs">Payment</TableHead>
                                          <TableHead className="text-xs">Cycle</TableHead>
                                          <TableHead className="w-8">
                                            <span className="sr-only">Details</span>
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {invoices.map((inv) => {
                                          const invBalance = Number(inv.balance);
                                          const lifecycle =
                                            inv.state === "void"
                                              ? "Void"
                                              : inv.period_start > today
                                                ? "Upcoming"
                                                : inv.period_end === membership.end_date
                                                  ? "Current"
                                                  : "Past";
                                          return (
                                            <TableRow
                                              key={inv.id}
                                              onClick={() => openInvoice(inv)}
                                              className="cursor-pointer"
                                            >
                                              <TableCell className="font-medium">
                                                {fmt.date(inv.period_start)} –{" "}
                                                {fmt.date(inv.period_end)}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums">
                                                {fmt.money(inv.fee_amount)}
                                              </TableCell>
                                              <TableCell className="text-right text-emerald-700 tabular-nums dark:text-emerald-400">
                                                {fmt.money(inv.amount_paid)}
                                              </TableCell>
                                              <TableCell className="text-right font-medium tabular-nums">
                                                {fmt.money(invBalance)}
                                              </TableCell>
                                              <TableCell>
                                                <Badge
                                                  variant={invBalance <= 0 ? "success" : "warning"}
                                                >
                                                  {invBalance <= 0 ? "Paid" : "Due"}
                                                </Badge>
                                              </TableCell>
                                              <TableCell>
                                                <Badge
                                                  variant={
                                                    lifecycle === "Void"
                                                      ? "neutral"
                                                      : lifecycle === "Upcoming"
                                                        ? "info"
                                                        : "secondary"
                                                  }
                                                >
                                                  {lifecycle}
                                                </Badge>
                                              </TableCell>
                                              <TableCell>
                                                {/* Whole row opens the invoice; this button is
                                                    the keyboard/AT path (stopPropagation so a
                                                    click doesn't fire the row handler too). */}
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon-sm"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    openInvoice(inv);
                                                  }}
                                                  aria-label={`View billing period starting ${fmt.date(inv.period_start)}`}
                                                >
                                                  <ChevronRight
                                                    className="size-4"
                                                    aria-hidden="true"
                                                  />
                                                </Button>
                                              </TableCell>
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>

                            </>
                          )}
                        </CardContent>
                      </Card>
                    </Section>

                    {/* Notes — the same authored thread as the lead detail
                        sheet (a member IS a contact). */}
                    <Section id="notes">
                      <Card>
                        <CardHeader>
                          <CardTitle>Notes</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ContactNotesThread
                            contactId={membership.contact_id}
                            active={open}
                            onFollowUpChanged={refreshAll}
                          />
                        </CardContent>
                      </Card>
                    </Section>

                    {/* Attendance — promoted from the rail to a full section. */}
                    <Section id="attendance">
                      <Card>
                        <CardHeader>
                          <CardTitle>Attendance</CardTitle>
                          <CardAction>
                            <Button size="sm" variant="outline" onClick={checkIn} disabled={busy}>
                              <UserCheck className="size-3.5" /> Check in
                            </Button>
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          {visits.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                              No check-ins recorded yet.
                            </p>
                          ) : (
                            <ul className="divide-border/50 divide-y">
                              {visits.map((v) => (
                                <li
                                  key={v.id}
                                  className="text-muted-foreground flex items-center gap-2 py-1.5 text-sm"
                                >
                                  <UserCheck className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                                  {fmt.dateTime(v.checked_in_at)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    </Section>

                    {/* Communication — static preview for now. */}
                    <Section id="communication">
                      <MemberCommunication />
                    </Section>

                    {/* Personal information */}
                    <Section id="personal">
                      {membership.contact && (
                        <MemberPersonalInfo
                          key={membership.contact_id}
                          contact={membership.contact}
                          canEdit={canSendMessages}
                          onSaved={refreshAll}
                        />
                      )}
                    </Section>

                    {/* Settings / danger zone */}
                    <Section id="settings">
                      <MemberDangerZone
                        contactId={membership.contact_id}
                        memberName={membership.contact?.name || ""}
                        canDelete={accountRole ? canDeleteMember(accountRole) : false}
                        onDeleted={() => {
                          onOpenChange(false);
                          onChanged();
                        }}
                      />
                    </Section>
                  </div>

                  {/* Rail — BMI only, sticky just under the jump nav. top
                      offset stays below the nav height but under the rail's
                      natural position, so it rests level with the Membership
                      card and only pins once scrolled. */}
                  <div className="grid min-w-0 gap-4 lg:sticky lg:top-[52px] lg:self-start">
                    <BmiCard
                      contactId={membership.contact_id}
                      heightCm={membership.contact?.height_cm}
                      weightKg={membership.contact?.weight_kg}
                      measurementSystem={locale.measurementSystem}
                      canEdit={canSendMessages}
                      onSaved={refreshAll}
                    />
                  </div>
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
              onOpenChange={(o) => {
                setPayOpen(o);
                if (!o) setPayPeriod(null);
              }}
              membership={membership}
              period={
                payPeriod
                  ? {
                      period_start: payPeriod.period_start,
                      period_end: payPeriod.period_end,
                      fee_amount: payPeriod.fee_amount,
                      balance: payPeriod.balance,
                    }
                  : undefined
              }
              onSaved={refreshAll}
            />
            <SetUpAutoPayDialog
              open={autoPayOpen}
              onOpenChange={setAutoPayOpen}
              membership={membership}
              onStarted={refreshAll}
            />
            <InvoiceDetailDialog
              open={invoiceOpen}
              onOpenChange={setInvoiceOpen}
              invoice={activeInvoice}
              canAct={canSendMessages}
              membershipEndDate={membership.end_date}
              canVoid={accountRole ? canCorrectPayments(accountRole) : false}
              onVoidPayment={setPaymentToVoid}
              onRecord={recordForPeriod}
              onRenew={() => setRenewOpen(true)}
            />
            <VoidPaymentDialog
              key={paymentToVoid?.id ?? "no-payment"}
              payment={paymentToVoid}
              open={!!paymentToVoid}
              onOpenChange={(next) => {
                if (!next) setPaymentToVoid(null);
              }}
              onVoided={refreshAll}
            />
            <AvatarEditorDialog
              open={avatarOpen}
              onOpenChange={setAvatarOpen}
              contactId={membership.contact_id}
              name={membership.contact?.name || "Member"}
              currentUrl={membership.contact?.avatar_url}
              onSaved={refreshAll}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
