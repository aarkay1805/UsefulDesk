'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
  Plus,
  MoreHorizontal,
  Camera,
  Ban,
  RotateCcw,
  Repeat,
  ArrowLeftRight,
  Hash,
  CircleAlert,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import {
  canCorrectPayments,
  canDeleteMember,
  canManageMandates,
  canRecordPayments,
  canReassignTrainer,
  canSellProductsServices,
} from '@/lib/auth/roles';
import {
  effectiveStatus,
  daysUntil,
  unfreezeEndDate,
} from '@/lib/memberships/expiry';
import { isRenewalChaseable, durationLabel } from '@/lib/memberships/pricing';
import {
  usageSummary,
  type CheckInWarning,
} from '@/lib/memberships/attendance-limits';
import { fetchCheckInUsage } from '@/lib/memberships/check-in';
import type {
  Membership,
  Payment,
  Attendance,
  MembershipPeriodInvoice,
  PaymentMandate,
  MemberService,
  InvoiceLine,
  Invoice,
  CheckoutSelection,
  MessageTemplate,
} from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  setMembershipCancellation,
  unfreezeMembership,
  invoicePaymentState,
  isChargeableAmount,
} from '@/lib/memberships/periods';
import {
  MembershipStatusBadge,
  FeeStatusBadge,
  TrialBadge,
  PlanTypeBadge,
  InvoicePaymentBadge,
  MemberServiceStatusBadge,
} from './membership-status-badge';
import { AttendanceOverrideDialog } from './attendance-override-dialog';
import { RenewMembershipDialog } from './renew-membership-dialog';
import { ChangePlanDialog } from './change-plan-dialog';
import { AvatarEditorDialog } from './avatar-editor-dialog';
import { SetUpAutoPayDialog } from './set-up-autopay-dialog';
import { defaultReason } from '@/lib/memberships/follow-ups';
import { ContactNotesThread } from '@/components/contacts/contact-notes-thread';
import { CopyUpiLinkButton, useUpiConfig } from './copy-upi-link-button';
import {
  SendReminderButton,
  type ReminderReadiness,
} from './send-reminder-button';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import { WhatsAppMark } from '@/components/brand/provider-mark';
import { BmiCard } from './bmi-card';
import { ChurnRiskCard } from './churn-risk-card';
import { MemberPersonalInfo } from './member-personal-info';
import { MemberCommunication } from './member-communication';
import { MemberDangerZone } from './member-danger-zone';
import { ProductServiceSaleDialog } from './product-service-sale-dialog';
import { ReassignTrainerDialog } from './reassign-trainer-dialog';
import {
  InvoiceDetailDialog,
  type InvoiceDetail,
} from '@/components/finance/invoice-detail-dialog';
import { RecordInvoicePaymentDialog } from '@/components/finance/record-invoice-payment-dialog';
import { VoidInvoicePaymentDialog } from '@/components/finance/void-invoice-payment-dialog';
import { financeInvoiceReference } from '@/lib/finance/invoices';
import { buildMemberPurchaseHref } from '@/lib/members/member-purchase-navigation';
import { ServiceCustomerDetailView } from './service-customer-detail-view';

type MemberInvoiceBalance = Invoice;

/** Jump-nav sections, in scroll order. Ids double as `#sec-<id>`. */
const SECTIONS = [
  { id: 'membership', label: 'Membership' },
  { id: 'products', label: 'Products & services' },
  { id: 'payments', label: 'Billing' },
  { id: 'notes', label: 'Notes & follow-ups' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'communication', label: 'Communication' },
  { id: 'personal', label: 'Personal info' },
  { id: 'settings', label: 'Settings' },
] as const;

type LifecycleAction = 'freeze' | 'resume' | 'cancel' | 'reactivate';

const LIFECYCLE_COPY: Record<
  LifecycleAction,
  { title: string; description: string; action: string; destructive?: boolean }
> = {
  freeze: {
    title: 'Freeze membership?',
    description:
      'Check-ins will pause. Existing invoice balances remain due, and the frozen days will be added to this cycle when you resume.',
    action: 'Freeze membership',
  },
  resume: {
    title: 'Resume membership?',
    description:
      'Check-ins will resume and this cycle will be extended by the paused days. Existing payments stay attached to the cycle.',
    action: 'Resume membership',
  },
  cancel: {
    title: 'Cancel membership?',
    description:
      'The membership will stop and its current invoice will be voided. Settled past cycles remain in billing history, and you can reactivate later.',
    action: 'Cancel membership',
    destructive: true,
  },
  reactivate: {
    title: 'Reactivate membership?',
    description:
      'The membership and its current billing period will reopen. Review the balance before collecting another payment.',
    action: 'Reactivate membership',
  },
};

interface MemberDetailViewProps {
  membershipId: string | null;
  contactId?: string | null;
  open: boolean;
  /** Parent-level refetch signal (for example, a saved edit dialog). */
  reloadKey?: number;
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

/** Section wrapper — id anchor for the jump nav and scrollspy. */
function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={`sec-${id}`} className="min-w-0">
      {children}
    </section>
  );
}

export function MemberDetailView(props: MemberDetailViewProps) {
  if (props.contactId && !props.membershipId) {
    return (
      <ServiceCustomerDetailView
        contactId={props.contactId}
        open={props.open}
        reloadKey={props.reloadKey}
        onOpenChange={props.onOpenChange}
        onChanged={props.onChanged}
      />
    );
  }
  return <MembershipDetailView {...props} />;
}

function MembershipDetailView({
  membershipId,
  open,
  reloadKey = 0,
  onOpenChange,
  readiness,
  onChanged,
  onEdit,
}: MemberDetailViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const { user, canSendMessages, accountRole } = useAuth();
  const { locale, fmt } = useLocale();
  const upi = useUpiConfig();
  const canSell = accountRole ? canSellProductsServices(accountRole) : false;
  const canRecordGenericPayment = accountRole
    ? canRecordPayments(accountRole)
    : false;
  const canReassign = accountRole ? canReassignTrainer(accountRole) : false;

  const [membership, setMembership] = useState<Membership | null>(null);
  const [visits, setVisits] = useState<Attendance[]>([]);
  const [invoices, setInvoices] = useState<MembershipPeriodInvoice[]>([]);
  const [services, setServices] = useState<MemberService[]>([]);
  const [merchandise, setMerchandise] = useState<InvoiceLine[]>([]);
  const [genericInvoices, setGenericInvoices] = useState<InvoiceDetail[]>([]);
  /** Visits inside the plan's usage window (062) — null = untracked. */
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const [overrideWarning, setOverrideWarning] = useState<CheckInWarning | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [invoiceTargetId, setInvoiceTargetId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentTargetId, setPaymentTargetId] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [autoPayOpen, setAutoPayOpen] = useState(false);
  const [mandate, setMandate] = useState<PaymentMandate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentToVoid, setPaymentToVoid] = useState<Payment | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [openingPurchasePage, setOpeningPurchasePage] = useState(false);
  const [saleInitial, setSaleInitial] = useState<CheckoutSelection[]>([]);
  const [reassignServiceTarget, setReassignServiceTarget] =
    useState<MemberService | null>(null);
  const [cancelServiceTarget, setCancelServiceTarget] =
    useState<MemberService | null>(null);
  const [cancelServiceReason, setCancelServiceReason] = useState('');
  const [cancellingService, setCancellingService] = useState(false);
  const [pendingLifecycle, setPendingLifecycle] =
    useState<LifecycleAction | null>(null);
  const [returnToInvoiceAfterPay, setReturnToInvoiceAfterPay] = useState(false);
  // Bumped to re-pull this sheet after a mutation (renew/payment/freeze/check-in).
  const [nonce, setNonce] = useState(0);

  // Jump-nav active section (scrollspy).
  const scrollRef = useRef<HTMLDivElement>(null);
  const navContainerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const jumpTargetRef = useRef<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('membership');

  useEffect(() => {
    if (!open || !membershipId) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      const { data: m, error: memberError } = await supabase
        .from('memberships')
        .select(
          '*, contact:contacts(*), plan:membership_plans(*), pricing_option:plan_pricing_options(*)'
        )
        .eq('id', membershipId)
        .maybeSingle();
      if (cancelled) return;
      if (memberError) {
        setLoadError(memberError.message);
        return;
      }
      if (!m) {
        setLoadError('Member not found or you no longer have access.');
        return;
      }

      const [
        attendanceResult,
        invoicesResult,
        mandateResult,
        servicesResult,
        genericBillingResult,
      ] = await Promise.all([
        supabase
          .from('attendance')
          .select('*')
          .eq('membership_id', membershipId)
          .order('checked_in_at', { ascending: false })
          .limit(20),
        supabase
          .from('membership_period_invoices')
          .select('*')
          .eq('membership_id', membershipId)
          .order('period_start', { ascending: false }),
        // The live auto-debit mandate (if any). Not load-critical — a
        // failure here just hides the auto-pay status, never blocks the
        // sheet.
        supabase
          .from('payment_mandates')
          .select('*')
          .eq('membership_id', membershipId)
          .in('status', ['creating', 'pending', 'active', 'paused', 'orphaned'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('member_service_details')
          .select('*')
          .eq('membership_id', membershipId)
          .order('start_date', { ascending: false }),
        (async () => {
          const { data: genericInvoices, error: genericError } = await supabase
            .from('invoice_balances')
            .select('*')
            .eq('membership_id', membershipId);
          if (genericError) return { data: null, error: genericError };
          const ids = (genericInvoices ?? []).map((invoice) => invoice.id);
          if (ids.length === 0) {
            return {
              data: { invoices: [], lines: [] },
              error: null,
            };
          }
          const lineResult = await supabase
            .from('invoice_line_balances')
            .select('*')
            .in('invoice_id', ids)
            .order('sort_order');
          return {
            data: {
              invoices: genericInvoices,
              lines: lineResult.data ?? [],
            },
            error: lineResult.error,
          };
        })(),
      ]);
      if (cancelled) return;
      const childError =
        attendanceResult.error ??
        invoicesResult.error ??
        servicesResult.error ??
        genericBillingResult.error;
      if (childError) {
        setLoadError(childError.message);
        return;
      }
      setMembership(m as Membership);
      setVisits((attendanceResult.data as Attendance[]) ?? []);
      setInvoices((invoicesResult.data as MembershipPeriodInvoice[]) ?? []);
      setServices((servicesResult.data as MemberService[]) ?? []);
      const loadedInvoiceLines =
        (genericBillingResult.data?.lines as InvoiceLine[]) ?? [];
      setMerchandise(
        loadedInvoiceLines
          .filter((line) => line.kind === 'merchandise')
          .sort((left, right) =>
            right.created_at.localeCompare(left.created_at)
          )
      );
      setGenericInvoices(
        (
          (genericBillingResult.data?.invoices as MemberInvoiceBalance[]) ?? []
        ).map((invoice) => ({
          id: invoice.id,
          reference: financeInvoiceReference(invoice.id),
          source: invoice.source,
          created_at: invoice.issued_at,
          fee_amount: Number(invoice.total),
          amount_paid: Number(invoice.amount_paid),
          credit_applied: Number(invoice.credit_applied),
          balance: Number(invoice.balance),
          gross_total: Number(invoice.gross_total),
          gross_amount_paid: Number(invoice.gross_amount_paid),
          processed_refund_amount: Number(invoice.processed_refund_amount),
          net_amount_paid: Number(invoice.net_amount_paid),
          invoice_adjustment_amount: Number(invoice.invoice_adjustment_amount),
          net_total: Number(invoice.net_total),
          accounting_balance: Number(invoice.accounting_balance),
          collectible_balance: Number(invoice.collectible_balance),
          requires_refund_review: Boolean(invoice.requires_refund_review),
          state: invoice.state,
        }))
      );
      setMandate((mandateResult.data as PaymentMandate | null) ?? null);

      // Usage vs the plan's limit / pack size (062) — count visits in
      // the plan's window. Not load-critical.
      const usage = await fetchCheckInUsage(
        supabase,
        m as Membership,
        fmt.today(),
        locale
      );
      if (cancelled) return;
      setUsageCount(usage ? usage.used : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, membershipId, nonce, reloadKey, supabase, fmt, locale]);

  // Scrollspy — highlight whichever section sits near the top of the
  // scroll body. Re-arms once the sections mount (membership loaded).
  useEffect(() => {
    if (!membership) return;
    const root = scrollRef.current;
    if (!root) return;
    const els = SECTIONS.map((s) =>
      document.getElementById(`sec-${s.id}`)
    ).filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const syncActiveSection = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const navHeight = navContainerRef.current?.offsetHeight ?? 0;
        const navBottom = root.getBoundingClientRect().top + navHeight;
        const atBottom =
          root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
        const active = atBottom
          ? els.at(-1)
          : (els.find((el) => el.getBoundingClientRect().bottom > navBottom) ??
            els.at(-1));
        if (active) setActiveSection(active.id.replace('sec-', ''));
      });
    };
    const handleScroll = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (jumpTargetRef.current) {
        settleTimer = setTimeout(() => {
          jumpTargetRef.current = null;
          syncActiveSection();
        }, 100);
        return;
      }
      syncActiveSection();
      settleTimer = setTimeout(syncActiveSection, 100);
    };
    root.addEventListener('scroll', handleScroll, { passive: true });
    syncActiveSection();
    return () => {
      root.removeEventListener('scroll', handleScroll);
      if (settleTimer) clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
    };
  }, [membership?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the lit tab visible. The strip scrolls sideways once the labels
  // outgrow it (~4 of 7 fit at 390px), so on mobile the scrollspy could
  // light a tab parked off-screen — the nav then reads as having no active
  // section at all. Centre it in the strip instead of scrollIntoView(),
  // which would also yank the vertical scroll body.
  useEffect(() => {
    const scroller = navRef.current;
    if (!scroller) return;
    const idx = SECTIONS.findIndex((s) => s.id === activeSection);
    const tab = scroller.querySelectorAll<HTMLElement>(
      '[data-slot="tabs-trigger"]'
    )[idx];
    if (!tab) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return; // nothing to scroll (desktop)
    const left = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
    scroller.scrollTo({
      left: Math.max(0, left),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [activeSection]);

  function jumpTo(id: string) {
    jumpTargetRef.current = id;
    setActiveSection(id);
    const root = scrollRef.current;
    const target = document.getElementById(`sec-${id}`);
    if (!root || !target) return;
    const navHeight = navContainerRef.current?.offsetHeight ?? 0;
    const top =
      target.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop -
      navHeight;
    root.scrollTo({
      top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }

  // Refetch this sheet AND tell the parent list to refresh.
  const refreshAll = useCallback(() => {
    setNonce((n) => n + 1);
    onChanged();
  }, [onChanged]);

  async function freeze(): Promise<boolean> {
    if (!membership) return false;
    setBusy(true);
    // Chain .select('id') — an RLS-blocked update returns no error + zero
    // rows, so an empty result is the real failure signal.
    const { data, error } = await supabase
      .from('memberships')
      .update({ status: 'frozen', frozen_at: fmt.today() })
      .eq('id', membership.id)
      .select('id');
    setBusy(false);
    if (error || !data?.length) {
      toast.error(error?.message ?? "Couldn't freeze — check your access.");
      return false;
    }
    toast.success('Membership frozen');
    refreshAll();
    return true;
  }

  async function unfreeze(): Promise<boolean> {
    if (!membership) return false;
    setBusy(true);
    // One transaction (migration 058): membership resumes, the current
    // period follows the shifted end_date, and its payments are
    // re-stamped to the new period key — nothing can diverge midway.
    const newEnd = unfreezeEndDate(membership.end_date, membership.frozen_at);
    const { error } = await unfreezeMembership(supabase, membership.id, newEnd);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success('Membership resumed');
    refreshAll();
    return true;
  }

  async function cancelMembership(): Promise<boolean> {
    if (!membership) return false;
    setBusy(true);
    // Cancel + void the current cycle's invoice atomically (058);
    // settled past cycles stay paid.
    const { error } = await setMembershipCancellation(
      supabase,
      membership.id,
      true
    );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success('Membership cancelled');
    refreshAll();
    return true;
  }

  async function reactivate(): Promise<boolean> {
    if (!membership) return false;
    setBusy(true);
    const { error } = await setMembershipCancellation(
      supabase,
      membership.id,
      false
    );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success('Membership reactivated');
    refreshAll();
    return true;
  }

  async function confirmLifecycleAction() {
    if (!pendingLifecycle) return;
    const succeeded =
      pendingLifecycle === 'freeze'
        ? await freeze()
        : pendingLifecycle === 'resume'
          ? await unfreeze()
          : pendingLifecycle === 'cancel'
            ? await cancelMembership()
            : await reactivate();
    if (succeeded) setPendingLifecycle(null);
  }

  async function insertCheckIn() {
    if (!membership || !user) return;
    const { error } = await supabase.from('attendance').insert({
      account_id: membership.account_id,
      contact_id: membership.contact_id,
      membership_id: membership.id,
      user_id: user.id,
      method: 'manual',
    });
    setOverrideWarning(null);
    if (error) return toast.error(error.message);
    toast.success('Checked in');
    refreshAll();
  }

  async function doCheckInInsert() {
    setCheckInBusy(true);
    try {
      await insertCheckIn();
    } finally {
      setCheckInBusy(false);
    }
  }

  async function checkIn() {
    if (!membership || !user) return;
    // Limit check (062): fresh count → warn-with-override, never a block.
    // A failed count returns null — never block the front desk.
    setCheckInBusy(true);
    try {
      const result = await fetchCheckInUsage(
        supabase,
        membership,
        today,
        locale
      );
      if (result) {
        setUsageCount(result.used);
        if (result.warning) {
          setOverrideWarning(result.warning);
          return;
        }
      }
      await insertCheckIn();
    } finally {
      setCheckInBusy(false);
    }
  }

  const today = fmt.today();
  const eff = membership ? effectiveStatus(membership, today) : null;
  const days = membership ? daysUntil(membership.end_date, today) : 0;

  const currentInvoice = membership
    ? (invoices.find((inv) => inv.period_end === membership.end_date) ?? null)
    : null;
  const outstandingBalance = invoices.reduce((total, invoice) => {
    const invoiceBalance = Number(invoice.balance);
    return invoice.state !== 'void' && isChargeableAmount(invoiceBalance)
      ? total + invoiceBalance
      : total;
  }, 0);

  const currentGenericInvoice = currentInvoice?.invoice_id
    ? (genericInvoices.find(
        (invoice) => invoice.id === currentInvoice.invoice_id
      ) ?? null)
    : null;
  const canCollectCurrent =
    !!currentGenericInvoice &&
    currentGenericInvoice.state === 'open' &&
    isChargeableAmount(currentGenericInvoice.balance) &&
    canRecordGenericPayment;
  // Auto-pay setup is a BILLING action (lives in the Billing section):
  // offered for an active, non-trial member on a RECURRING plan (only
  // recurring plans auto-renew, 062) who has no live mandate yet.
  const canSetupAutoPay =
    !!membership &&
    !!accountRole &&
    canManageMandates(accountRole) &&
    membership.status === 'active' &&
    !membership.is_trial &&
    isRenewalChaseable(membership.plan) &&
    !mandate;
  const membershipLifecycleBlockReason = mandate
    ? "Resolve this member's AutoPay mandate before changing this membership."
    : null;

  // Usage vs limit / sessions left (062) — the Attendance section line.
  const usagePlan = membership?.plan ?? null;
  const usageStats =
    usagePlan && usageCount !== null
      ? usageSummary(usagePlan, usageCount)
      : null;
  const usageLine = usageStats
    ? { text: usageStats.label, danger: usageStats.danger }
    : null;

  // Plan-type-aware billing summary for the Membership card. A recurring
  // plan doesn't "expire" — it renews on end_date — so the date column and
  // the amount column relabel by type (recurring | fixed-term | pack), and
  // legacy null-plan rows read as recurring (same rule as the renewal chase).
  const planType = membership?.plan?.plan_type ?? null;
  const isRecurringMembership = isRenewalChaseable(membership?.plan);
  const pricingOption = membership?.pricing_option ?? null;
  const cadenceLabel = pricingOption
    ? durationLabel(pricingOption.duration_count, pricingOption.duration_unit)
    : null;
  // The end_date column's meaning depends on plan type + whether it's passed.
  const termLabel =
    eff === 'expired'
      ? 'Expired'
      : isRecurringMembership
        ? 'Renews'
        : 'Expires';

  // Services and merchandise share one newest-first product summary. The
  // source records stay distinct because services retain lifecycle actions.
  const purchases = [
    ...services.map((service) => ({
      kind: 'service' as const,
      sortDate: service.start_date,
      service,
    })),
    ...merchandise.map((line) => ({
      kind: 'merchandise' as const,
      sortDate: line.created_at,
      line,
    })),
  ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  // Billing follows the immutable invoice ledger: one checkout = one row,
  // even when the invoice contains membership, service, and merchandise
  // lines with different service dates.
  const billingInvoices = [...genericInvoices].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
  const invoiceTarget = invoiceTargetId
    ? (genericInvoices.find((invoice) => invoice.id === invoiceTargetId) ??
      null)
    : null;
  const paymentTarget = paymentTargetId
    ? (genericInvoices.find((invoice) => invoice.id === paymentTargetId) ??
      null)
    : null;

  function openSale() {
    if (!membership) return;
    setOpeningPurchasePage(true);
    router.push(buildMemberPurchaseHref(window.location.href, membership.id));
  }

  async function sendSelectedTemplate(
    template: MessageTemplate,
    values: TemplateSendValues
  ) {
    if (!membership) return;
    setSendingTemplate(true);
    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: membership.contact_id,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      toast.success(`Template "${template.name}" sent`);
    } catch (error) {
      toast.error(
        `Failed to send template: ${getErrorMessage(error, 'network error')}`
      );
    } finally {
      setSendingTemplate(false);
    }
  }

  function renewService(service: MemberService) {
    if (!service.catalog_item_id || !service.catalog_option_id) return;
    if (
      service.requires_trainer &&
      (!service.trainer_id || service.current_renewal_price == null)
    ) {
      toast.error(
        "Configure the current trainer's rate before renewing this service."
      );
      return;
    }
    setSaleInitial([
      {
        item_id: service.catalog_item_id,
        option_id: service.catalog_option_id,
        trainer_id: service.trainer_id,
        quantity: 1,
        start_date: service.end_date,
        renewed_from_service_id: service.id,
        unit_amount: Number(service.current_renewal_price),
      },
    ]);
    setSaleOpen(true);
  }

  async function confirmCancelService() {
    if (!cancelServiceTarget || !cancelServiceReason.trim()) return;
    setCancellingService(true);
    try {
      const { error } = await supabase.rpc('cancel_member_service', {
        p_member_service_id: cancelServiceTarget.id,
        p_reason: cancelServiceReason.trim(),
      });
      if (error) return toast.error(error.message);
      toast.success('Service cancelled. No financial credit was created.');
      setCancelServiceTarget(null);
      setCancelServiceReason('');
      refreshAll();
    } finally {
      setCancellingService(false);
    }
  }
  const lifecycleCopy = pendingLifecycle
    ? LIFECYCLE_COPY[pendingLifecycle]
    : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The sheet master caps side=right at sm:max-w-sm via a
        // data-variant, which beats a plain sm:max-w-* — match the
        // variant to actually widen (same trick as the contact sheet).
        // Grows to fill available space instead of leaving it empty with
        // scrollbars inside (min() = viewport-minus-a-sliver, hard-capped at
        // 1200px so it doesn't sprawl on an ultrawide). Width must also carry
        // the data-[side=right] variant — the master sets
        // data-[side=right]:w-3/4, and a bare w-full doesn't beat it
        // (tailwind-merge only dedupes same-variant utilities).
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1200px,calc(100vw-2rem))]"
      >
        {loadError ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-border border-b p-4 pr-12 sm:p-5 sm:pr-12">
              <SheetTitle>Member profile</SheetTitle>
              <SheetDescription>
                We couldn&apos;t load this member&apos;s details.
              </SheetDescription>
            </SheetHeader>
            <div className="bg-muted/20 flex flex-1 items-start justify-center p-4 sm:items-center sm:p-6">
              <Alert variant="destructive" className="max-w-md">
                <CircleAlert className="size-4" />
                <AlertTitle>Could not load this member safely</AlertTitle>
                <AlertDescription>
                  <p>{loadError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setNonce((n) => n + 1)}
                  >
                    <RefreshCw className="size-3.5" /> Try again
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          </div>
        ) : !membership || membership.id !== membershipId ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-border border-b p-4 pr-12 sm:p-5 sm:pr-12">
              <SheetTitle>Member profile</SheetTitle>
              <SheetDescription>Loading member details…</SheetDescription>
            </SheetHeader>
            <div
              className="bg-muted/20 text-muted-foreground flex flex-1 items-center justify-center gap-2 p-6"
              role="status"
            >
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span>Loading member profile…</span>
            </div>
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
                      name={membership.contact?.name || '?'}
                      src={membership.contact?.avatar_url}
                      className="size-11 sm:size-14"
                      fallbackClassName="text-base sm:text-lg"
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar-edit:opacity-100">
                      <Camera className="size-5" />
                    </span>
                  </button>
                ) : (
                  <UserAvatar
                    name={membership.contact?.name || '?'}
                    src={membership.contact?.avatar_url}
                    className="size-11 sm:size-14"
                    fallbackClassName="text-base sm:text-lg"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-base sm:text-lg">
                      {membership.contact?.name || 'Unnamed member'}
                    </SheetTitle>
                    {membership.is_trial && <TrialBadge />}
                    {eff && (
                      <MembershipStatusBadge status={eff} daysToExpiry={days} />
                    )}
                    {!membership.is_trial &&
                      membership.status !== 'cancelled' && (
                        <FeeStatusBadge status={membership.fee_status} />
                      )}
                  </div>
                  <SheetDescription className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="flex items-center gap-1.5">
                      <Hash className="size-3.5" />
                      Member ID
                      <span className="font-mono tabular-nums">
                        {membership.member_number}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Phone className="size-3.5" />
                      {membership.contact?.phone || 'No phone'}
                    </span>
                    {membership.contact?.email && (
                      <span className="flex items-center gap-1.5">
                        <Mail className="size-3.5" />
                        {membership.contact.email}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      Member since{' '}
                      {fmt.date(membership.created_at.slice(0, 10))}
                    </span>
                  </SheetDescription>
                </div>
                {/* Actions take their own full-width row on mobile (the
                    identity block above is already tight at 390px), and the
                    buttons split it evenly. Renew is NOT here — it's a
                    lifecycle action in the Membership ⋯ menu; as a header
                    primary it read as "the thing to do" on every member,
                    including one who just paid. */}
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
                  <SendReminderButton
                    membership={membership}
                    readiness={readiness}
                    onSent={() => {}}
                    size="default"
                    variant="outline"
                  />
                  <GatedButton
                    type="button"
                    variant="outline"
                    canAct={canSendMessages}
                    gateReason="send WhatsApp templates"
                    loading={sendingTemplate}
                    onClick={() => setTemplatePickerOpen(true)}
                    className="w-full sm:w-auto"
                  >
                    <WhatsAppMark className="size-4" />
                    Template
                  </GatedButton>
                  {membership.is_trial && canSendMessages && (
                    <Button onClick={() => setConvertOpen(true)}>
                      <UserPlus className="size-4" /> Convert to member
                    </Button>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div ref={scrollRef} className="bg-muted/20 flex-1 overflow-y-auto">
              {/* Jump nav — reads as part of the sheet header, with the
                  divider after the tabs; sticky under it while scrolling. */}
              <div
                ref={navContainerRef}
                className="border-border bg-popover sticky top-0 z-10 border-b"
              >
                <div
                  ref={navRef}
                  className="[scrollbar-width:none] overflow-x-auto px-4 sm:px-5 [&::-webkit-scrollbar]:hidden"
                >
                  <Tabs
                    value={activeSection}
                    onValueChange={(v) => v && jumpTo(v)}
                  >
                    <TabsList
                      variant="line"
                      aria-label="Member detail sections"
                    >
                      {SECTIONS.map((s) => (
                        <TabsTrigger
                          key={s.id}
                          value={s.id}
                          className="flex-none"
                        >
                          {s.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {/* Main column (sections) + sticky BMI rail. */}
              <div className="p-4 sm:p-5">
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(640px,1fr)_310px]">
                  {/* min-w-0 (not a px floor) — the lg grid track already
                      floors the column at 640px; a raw min-width would also
                      apply on mobile and force the whole sheet to scroll. */}
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
                              <DropdownMenuContent
                                align="end"
                                className="min-w-52"
                              >
                                {/* Renew — opens the next billing cycle. Lives
                                    here (not as a header primary) because it's
                                    only the right move near/after expiry; the
                                    Billing section's Upcoming invoice offers it
                                    too, but that row is absent once a
                                    membership has lapsed, so this is the path
                                    that always works. */}
                                {membership.status === 'active' &&
                                  !membership.is_trial && (
                                    <DropdownMenuItem
                                      onClick={() => setRenewOpen(true)}
                                      disabled={
                                        !canSendMessages ||
                                        !!membershipLifecycleBlockReason
                                      }
                                      title={
                                        membershipLifecycleBlockReason ??
                                        (!canSendMessages
                                          ? 'You need member-management access to renew memberships.'
                                          : undefined)
                                      }
                                    >
                                      <RefreshCw className="size-4" /> Renew
                                      membership
                                    </DropdownMenuItem>
                                  )}
                                {/* Plan swap/upgrade — the intent behind most
                                    "edit" clicks. Only an active paid cycle
                                    can be switched mid-flight. */}
                                {membership.status === 'active' &&
                                  !membership.is_trial && (
                                    <DropdownMenuItem
                                      onClick={() => setChangePlanOpen(true)}
                                      disabled={
                                        !canSendMessages ||
                                        !!membershipLifecycleBlockReason
                                      }
                                      title={
                                        membershipLifecycleBlockReason ??
                                        (!canSendMessages
                                          ? 'You need member-management access to change plans.'
                                          : undefined)
                                      }
                                    >
                                      <ArrowLeftRight className="size-4" />{' '}
                                      Change plan
                                    </DropdownMenuItem>
                                  )}
                                <DropdownMenuItem
                                  onClick={() => onEdit(membership)}
                                  disabled={
                                    !canSendMessages ||
                                    !!membershipLifecycleBlockReason
                                  }
                                  title={
                                    membershipLifecycleBlockReason ??
                                    (!canSendMessages
                                      ? 'You need member-management access to edit memberships.'
                                      : undefined)
                                  }
                                >
                                  <Pencil className="size-4" /> Edit membership
                                </DropdownMenuItem>
                                {membership.status === 'frozen' ? (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setPendingLifecycle('resume')
                                    }
                                    disabled={
                                      busy ||
                                      !canSendMessages ||
                                      !!membershipLifecycleBlockReason
                                    }
                                    title={
                                      membershipLifecycleBlockReason ??
                                      (!canSendMessages
                                        ? 'You need member-management access to resume memberships.'
                                        : undefined)
                                    }
                                  >
                                    <Play className="size-4" /> Resume
                                    membership
                                  </DropdownMenuItem>
                                ) : (
                                  membership.status === 'active' && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setPendingLifecycle('freeze')
                                      }
                                      disabled={
                                        busy ||
                                        !canSendMessages ||
                                        !!membershipLifecycleBlockReason
                                      }
                                      title={
                                        membershipLifecycleBlockReason ??
                                        (!canSendMessages
                                          ? 'You need member-management access to freeze memberships.'
                                          : undefined)
                                      }
                                    >
                                      <Snowflake className="size-4" /> Freeze
                                      membership
                                    </DropdownMenuItem>
                                  )
                                )}
                                {membership.status === 'cancelled' ? (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setPendingLifecycle('reactivate')
                                    }
                                    disabled={
                                      busy ||
                                      !canSendMessages ||
                                      !!membershipLifecycleBlockReason
                                    }
                                    title={
                                      membershipLifecycleBlockReason ??
                                      (!canSendMessages
                                        ? 'You need member-management access to reactivate memberships.'
                                        : undefined)
                                    }
                                  >
                                    <RotateCcw className="size-4" /> Reactivate
                                    membership
                                  </DropdownMenuItem>
                                ) : (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() =>
                                        setPendingLifecycle('cancel')
                                      }
                                      disabled={
                                        busy ||
                                        !canSendMessages ||
                                        !!membershipLifecycleBlockReason
                                      }
                                      title={
                                        membershipLifecycleBlockReason ??
                                        (!canSendMessages
                                          ? 'You need member-management access to cancel memberships.'
                                          : undefined)
                                      }
                                    >
                                      <Ban className="size-4" /> Cancel
                                      membership
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </CardAction>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Stat label="Plan">
                              {membership.plan?.name ?? '—'}
                            </Stat>
                            <Stat
                              label={isRecurringMembership ? 'Billing' : 'Fee'}
                            >
                              {isRecurringMembership && pricingOption ? (
                                <span className="tabular-nums">
                                  {fmt.money(pricingOption.price)}
                                  {cadenceLabel && (
                                    <span className="text-muted-foreground font-normal">
                                      {' '}
                                      / {cadenceLabel}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="tabular-nums">
                                  {fmt.money(membership.fee_amount)}
                                </span>
                              )}
                            </Stat>
                            <Stat label="Started">
                              {fmt.date(membership.start_date)}
                            </Stat>
                            <Stat label={termLabel}>
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="tabular-nums">
                                  {fmt.date(membership.end_date)}
                                </span>
                                {eff ? (
                                  <MembershipStatusBadge status={eff} />
                                ) : null}
                              </span>
                            </Stat>
                          </dl>
                          {isRecurringMembership &&
                            membership.status === 'active' && (
                              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                                <Repeat className="size-3.5 shrink-0" />
                                {mandate?.status === 'active' ? (
                                  <>
                                    Auto-renews
                                    {cadenceLabel
                                      ? ` every ${cadenceLabel}`
                                      : ''}{' '}
                                    on {fmt.date(membership.end_date)}.
                                  </>
                                ) : (
                                  <>
                                    Renews
                                    {cadenceLabel
                                      ? ` every ${cadenceLabel}`
                                      : ''}{' '}
                                    — next cycle starts{' '}
                                    {fmt.date(membership.end_date)}.
                                  </>
                                )}
                              </p>
                            )}
                          {planType === 'non_recurring' && (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                              <CalendarDays className="size-3.5 shrink-0" />
                              Fixed-term plan — ends{' '}
                              {fmt.date(membership.end_date)} and does not
                              renew.
                            </p>
                          )}
                          {membership.plan?.plan_type === 'session_pack' &&
                            usageLine && (
                              <p
                                className={`text-xs ${
                                  usageLine.danger
                                    ? 'text-red-foreground'
                                    : 'text-muted-foreground'
                                }`}
                              >
                                {usageLine.text}
                              </p>
                            )}
                          {membership.status === 'frozen' &&
                            membership.frozen_at && (
                              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                                <Snowflake className="size-3.5" />
                                Frozen since {fmt.date(membership.frozen_at)} —
                                the paused days are added back on resume.
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

                    {/* Member-only catalogue history. Service dates remain
                        independent from the membership lifecycle. */}
                    <Section id="products">
                      <Card>
                        <CardHeader>
                          <CardTitle>Products &amp; services</CardTitle>
                          {canSell ? (
                            <CardAction>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={openSale}
                                loading={openingPurchasePage}
                              >
                                <Plus className="size-4" /> Add purchase
                              </Button>
                            </CardAction>
                          ) : null}
                        </CardHeader>
                        <CardContent>
                          {purchases.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                              No products or services purchased yet.
                            </p>
                          ) : (
                            <div className="space-y-4">
                              {purchases.map((purchase, index) => {
                                const isService = purchase.kind === 'service';
                                const service = isService
                                  ? purchase.service
                                  : null;
                                const line = isService ? null : purchase.line;

                                return (
                                  <div
                                    key={`${purchase.kind}-${
                                      service?.id ?? line?.id
                                    }`}
                                    className={
                                      index === 0
                                        ? 'relative'
                                        : 'border-border relative border-t pt-4'
                                    }
                                  >
                                    {service &&
                                    (canSell ||
                                      (canReassign &&
                                        service.requires_trainer)) &&
                                    service.status !== 'cancelled' ? (
                                      <div className="absolute top-0 right-0">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger
                                            render={
                                              <Button
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label={`Manage ${service.item_name_snapshot}`}
                                              />
                                            }
                                          >
                                            <MoreHorizontal className="size-4" />
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent
                                            align="end"
                                            className="min-w-44"
                                          >
                                            {canSell ? (
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  renewService(service)
                                                }
                                              >
                                                <RefreshCw className="size-4" />{' '}
                                                Renew
                                              </DropdownMenuItem>
                                            ) : null}
                                            {canReassign &&
                                            service.requires_trainer ? (
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  setReassignServiceTarget(
                                                    service
                                                  )
                                                }
                                              >
                                                <ArrowLeftRight className="size-4" />{' '}
                                                Reassign trainer
                                              </DropdownMenuItem>
                                            ) : null}
                                            {canSell ? (
                                              <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                  variant="destructive"
                                                  onClick={() =>
                                                    setCancelServiceTarget(
                                                      service
                                                    )
                                                  }
                                                >
                                                  <Ban className="size-4" />{' '}
                                                  Cancel service
                                                </DropdownMenuItem>
                                              </>
                                            ) : null}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    ) : null}

                                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                      <Stat
                                        label={
                                          service
                                            ? service.item_name_snapshot
                                            : line?.description || 'Merchandise'
                                        }
                                      >
                                        {service
                                          ? service.trainer_name || '—'
                                          : 'Merchandise'}
                                      </Stat>
                                      <Stat label="Billing">
                                        <span className="tabular-nums">
                                          {fmt.money(
                                            service?.sold_amount ??
                                              line?.line_amount ??
                                              0
                                          )}
                                          {service ? (
                                            <span className="text-muted-foreground font-normal">
                                              {' '}
                                              /{' '}
                                              {durationLabel(
                                                service.option_duration_count,
                                                service.option_duration_unit
                                              )}
                                            </span>
                                          ) : null}
                                        </span>
                                      </Stat>
                                      <Stat
                                        label={
                                          service ? 'Started' : 'Purchased'
                                        }
                                      >
                                        {fmt.date(
                                          service?.start_date ??
                                            line?.created_at ??
                                            ''
                                        )}
                                      </Stat>
                                      <Stat
                                        label={service ? 'Expires' : 'Quantity'}
                                      >
                                        {service ? (
                                          <span className="flex flex-wrap items-center gap-2">
                                            <span className="tabular-nums">
                                              {fmt.date(service.end_date)}
                                            </span>
                                            <MemberServiceStatusBadge
                                              status={service.derived_status}
                                            />
                                          </span>
                                        ) : (
                                          line?.quantity
                                        )}
                                      </Stat>
                                    </dl>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Section>

                    {/* Payments */}
                    <Section id="payments">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            Billing
                            {membership.plan?.plan_type && (
                              <PlanTypeBadge type={membership.plan.plan_type} />
                            )}
                          </CardTitle>
                          {!membership.is_trial &&
                            (canCollectCurrent || canSetupAutoPay) && (
                              <CardAction className="col-span-2 col-start-1 row-start-2 mt-2 flex w-full flex-wrap items-center justify-start gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:w-auto sm:justify-end">
                                {canCollectCurrent && (
                                  <>
                                    <CopyUpiLinkButton
                                      upi={upi}
                                      amount={Number(
                                        currentGenericInvoice!.balance
                                      )}
                                      note={`Invoice ${currentGenericInvoice!.reference}`}
                                      size="sm"
                                    />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setReturnToInvoiceAfterPay(false);
                                        setPaymentTargetId(
                                          currentGenericInvoice!.id
                                        );
                                      }}
                                    >
                                      <Wallet className="size-4" /> Record
                                      payment
                                    </Button>
                                  </>
                                )}
                                {canSetupAutoPay && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setAutoPayOpen(true)}
                                  >
                                    <Repeat className="size-4" /> Set up
                                    auto-pay
                                  </Button>
                                )}
                              </CardAction>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-5">
                          {membership.is_trial ? (
                            <p className="text-muted-foreground text-sm">
                              Trials are not billed. Convert to a member to
                              start invoicing.
                            </p>
                          ) : (
                            <>
                              {membership.status === 'cancelled' && (
                                <p className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                                  This membership is cancelled. Its current
                                  billing period is not collectible.
                                </p>
                              )}

                              {mandate && (
                                <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                                  <Repeat className="size-3.5" />
                                  {mandate.status === 'active' ? (
                                    <>
                                      Auto-pay on
                                      {mandate.vpa
                                        ? ` · ${mandate.vpa}`
                                        : ' · UPI AutoPay'}
                                      {' — renewals collect automatically.'}
                                    </>
                                  ) : mandate.status === 'orphaned' ? (
                                    <>
                                      Auto-pay setup needs payment
                                      reconciliation review before retrying.
                                    </>
                                  ) : mandate.status === 'creating' ? (
                                    <>Auto-pay setup is in progress.</>
                                  ) : mandate.status === 'paused' ? (
                                    <>Auto-pay is paused and needs review.</>
                                  ) : (
                                    <>
                                      Auto-pay mandate pending the member&apos;s
                                      approval.
                                    </>
                                  )}
                                </p>
                              )}

                              <div className="space-y-2">
                                {billingInvoices.length === 0 ? (
                                  <p className="text-muted-foreground text-sm">
                                    No billing history yet.
                                  </p>
                                ) : (
                                  <div className="border-border overflow-hidden rounded-lg border">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead>Invoice</TableHead>
                                          <TableHead className="hidden sm:table-cell">
                                            Issued on
                                          </TableHead>
                                          <TableHead className="text-right">
                                            Total
                                          </TableHead>
                                          <TableHead className="hidden text-right sm:table-cell">
                                            Paid
                                          </TableHead>
                                          <TableHead className="hidden text-right sm:table-cell">
                                            Balance
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {billingInvoices.map((invoice) => {
                                          const payState = invoicePaymentState({
                                            fee_amount: Number(
                                              invoice.fee_amount
                                            ),
                                            amount_paid:
                                              Number(invoice.amount_paid) +
                                              Number(
                                                invoice.credit_applied ?? 0
                                              ),
                                            balance: Number(invoice.balance),
                                          });

                                          return (
                                            <TableRow
                                              key={invoice.id}
                                              onClick={() => {
                                                setInvoiceTargetId(invoice.id);
                                                setInvoiceOpen(true);
                                              }}
                                              onKeyDown={(event) => {
                                                if (
                                                  event.key === 'Enter' ||
                                                  event.key === ' '
                                                ) {
                                                  event.preventDefault();
                                                  setInvoiceTargetId(
                                                    invoice.id
                                                  );
                                                  setInvoiceOpen(true);
                                                }
                                              }}
                                              tabIndex={0}
                                              aria-haspopup="dialog"
                                              aria-label={`View ${invoice.reference}`}
                                              className="cursor-pointer"
                                            >
                                              <TableCell>
                                                <span className="inline-flex items-center gap-2">
                                                  <span className="text-xs font-medium tabular-nums">
                                                    {invoice.reference}
                                                  </span>
                                                  {invoice.state === 'void' ? (
                                                    <Badge variant="neutral">
                                                      Void
                                                    </Badge>
                                                  ) : (
                                                    <InvoicePaymentBadge
                                                      state={payState}
                                                    />
                                                  )}
                                                </span>
                                              </TableCell>
                                              <TableCell className="text-muted-foreground hidden text-xs tabular-nums sm:table-cell">
                                                {fmt.date(invoice.created_at)}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums">
                                                {fmt.money(invoice.fee_amount)}
                                              </TableCell>
                                              <TableCell className="text-emerald-foreground hidden text-right tabular-nums sm:table-cell">
                                                {fmt.money(invoice.amount_paid)}
                                              </TableCell>
                                              <TableCell
                                                className={`hidden text-right tabular-nums sm:table-cell ${
                                                  isChargeableAmount(
                                                    invoice.balance
                                                  )
                                                    ? 'text-amber-foreground'
                                                    : ''
                                                }`}
                                              >
                                                {fmt.money(invoice.balance)}
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

                    {/* Notes & follow-ups — the same activity thread as the lead detail
                        sheet (a member IS a contact). */}
                    <Section id="notes">
                      <Card>
                        <CardHeader>
                          <CardTitle>Notes &amp; follow-ups</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ContactNotesThread
                            contactId={membership.contact_id}
                            membershipId={membership.id}
                            active={open}
                            followUpReason={defaultReason(
                              membership,
                              fmt.today()
                            )}
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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={checkIn}
                              loading={checkInBusy}
                              disabled={checkInBusy}
                            >
                              <UserCheck className="size-3.5" /> Check in
                            </Button>
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          {usageLine && (
                            <p className="mb-2 text-xs">
                              <Badge
                                variant={usageLine.danger ? 'danger' : 'info'}
                              >
                                {usageLine.text}
                              </Badge>
                            </p>
                          )}
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
                                  <UserCheck className="text-emerald-foreground size-3.5 shrink-0" />
                                  {fmt.dateTime(v.checked_in_at)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    </Section>

                    {/* Communication — template-send log (renewal
                        reminders etc.), not a chat; replies live in the
                        Inbox. Keyed by contact so switching members
                        resets state. */}
                    <Section id="communication">
                      <MemberCommunication
                        key={membership.contact_id}
                        contactId={membership.contact_id}
                        active={open}
                      />
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
                        memberName={membership.contact?.name || ''}
                        canDelete={
                          accountRole ? canDeleteMember(accountRole) : false
                        }
                        blockedReason={membershipLifecycleBlockReason}
                        onDeleted={() => {
                          onOpenChange(false);
                          onChanged();
                        }}
                      />
                    </Section>
                  </div>

                  {/* Rail — profile signals, sticky just under the shared
                      line-tab nav while remaining level with Membership. */}
                  <div className="grid min-w-0 gap-4 lg:sticky lg:top-9 lg:self-start">
                    <BmiCard
                      contactId={membership.contact_id}
                      heightCm={membership.contact?.height_cm}
                      weightKg={membership.contact?.weight_kg}
                      measurementSystem={locale.measurementSystem}
                      canEdit={canSendMessages}
                      onSaved={refreshAll}
                    />
                    <ChurnRiskCard
                      key={`${membership.contact_id}-${membership.contact?.churn_risk}`}
                      contactId={membership.contact_id}
                      churnRisk={membership.contact?.churn_risk}
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
              outstandingBalance={outstandingBalance}
              onSaved={refreshAll}
            />
            <RenewMembershipDialog
              open={convertOpen}
              onOpenChange={setConvertOpen}
              membership={membership}
              variant="convert"
              onSaved={refreshAll}
            />
            <ChangePlanDialog
              open={changePlanOpen}
              onOpenChange={setChangePlanOpen}
              membership={membership}
              currentInvoice={currentInvoice}
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
              invoice={invoiceTarget}
              member={membership}
              canRecord={canRecordGenericPayment}
              canVoid={accountRole ? canCorrectPayments(accountRole) : false}
              onVoidPayment={setPaymentToVoid}
              onRecord={() => {
                if (!invoiceTarget) return;
                setReturnToInvoiceAfterPay(true);
                setPaymentTargetId(invoiceTarget.id);
                setInvoiceOpen(false);
              }}
            />
            {paymentTarget ? (
              <RecordInvoicePaymentDialog
                key={paymentTarget.id}
                invoice={paymentTarget}
                open
                onOpenChange={(next) => {
                  if (!next) setPaymentTargetId(null);
                }}
                onSaved={() => {
                  setReturnToInvoiceAfterPay(false);
                  refreshAll();
                }}
                onCancelled={() => {
                  if (returnToInvoiceAfterPay) {
                    setInvoiceTargetId(paymentTarget.id);
                    setInvoiceOpen(true);
                  }
                  setReturnToInvoiceAfterPay(false);
                }}
              />
            ) : null}
            <Dialog
              open={!!pendingLifecycle}
              onOpenChange={(next) => {
                if (!next && !busy) setPendingLifecycle(null);
              }}
            >
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>{lifecycleCopy?.title}</DialogTitle>
                  <DialogDescription>
                    {lifecycleCopy?.description}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPendingLifecycle(null)}
                    disabled={busy}
                  >
                    Keep membership
                  </Button>
                  <Button
                    type="button"
                    variant={
                      lifecycleCopy?.destructive ? 'destructive' : 'default'
                    }
                    onClick={confirmLifecycleAction}
                    disabled={busy}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {lifecycleCopy?.action}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <VoidInvoicePaymentDialog
              key={paymentToVoid?.id ?? 'no-payment'}
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
              name={membership.contact?.name || 'Member'}
              currentUrl={membership.contact?.avatar_url}
              onSaved={refreshAll}
            />
            <TemplatePicker
              open={templatePickerOpen}
              onOpenChange={setTemplatePickerOpen}
              onSelect={sendSelectedTemplate}
              contact={membership.contact}
            />
            <AttendanceOverrideDialog
              open={!!overrideWarning}
              warning={overrideWarning}
              busy={checkInBusy}
              onConfirm={doCheckInInsert}
              onCancel={() => setOverrideWarning(null)}
            />
            <ProductServiceSaleDialog
              key={`${saleInitial.map((selection) => selection.option_id).join(',')}:${saleOpen ? 'open' : 'closed'}`}
              open={saleOpen}
              onOpenChange={setSaleOpen}
              membership={membership}
              mode="service_renewal"
              initialSelections={saleInitial}
              onSaved={refreshAll}
            />
            <ReassignTrainerDialog
              key={reassignServiceTarget?.id ?? 'no-service'}
              service={reassignServiceTarget}
              open={!!reassignServiceTarget}
              onOpenChange={(next) => {
                if (!next) setReassignServiceTarget(null);
              }}
              onSaved={refreshAll}
            />
            <Dialog
              open={!!cancelServiceTarget}
              onOpenChange={(next) => {
                if (!next && !cancellingService) {
                  setCancelServiceTarget(null);
                  setCancelServiceReason('');
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel service?</DialogTitle>
                  <DialogDescription>
                    The service stops, but this does not issue a refund or
                    credit.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                  <Label htmlFor="cancel-service-reason">Reason</Label>
                  <Input
                    id="cancel-service-reason"
                    value={cancelServiceReason}
                    onChange={(event) =>
                      setCancelServiceReason(event.target.value)
                    }
                    placeholder="Required for history"
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCancelServiceTarget(null)}
                    disabled={cancellingService}
                  >
                    Keep service
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={confirmCancelService}
                    loading={cancellingService}
                    disabled={cancellingService || !cancelServiceReason.trim()}
                  >
                    Cancel service
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
