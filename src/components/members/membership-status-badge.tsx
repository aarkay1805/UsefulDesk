import { Badge } from '@/components/ui/badge';
import type { InvoicePaymentState } from '@/lib/memberships/periods';
import type {
  MembershipStatus,
  MembershipFeeStatus,
  InvoiceStatus,
  Payment,
  PaymentStatus,
  PlanType,
} from '@/types';

/**
 * Coloured pills for a membership's effective status and its fee state.
 * Kept in one place so the members table, detail view, and renewal
 * action lists all read the same colours. Thin wrappers over the Badge
 * primitive's tinted variants so the status → variant mapping stays
 * explicit and self-contained.
 */

const STATUS_VARIANT: Record<
  MembershipStatus,
  { label: string; variant: 'success' | 'danger' | 'info' | 'neutral' }
> = {
  active: { label: 'Active', variant: 'success' },
  expired: { label: 'Expired', variant: 'danger' },
  frozen: { label: 'Frozen', variant: 'info' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

/**
 * Renders the effective status. When `daysToExpiry` is supplied and the
 * membership is active and within the given window, it upgrades to an
 * amber "Expiring" pill so the renewal lists read at a glance.
 */
export function MembershipStatusBadge({
  status,
  daysToExpiry,
  expiringWithin = 7,
}: {
  status: MembershipStatus;
  daysToExpiry?: number;
  expiringWithin?: number;
}) {
  if (
    status === 'active' &&
    typeof daysToExpiry === 'number' &&
    daysToExpiry >= 0 &&
    daysToExpiry <= expiringWithin
  ) {
    const label =
      daysToExpiry === 0 ? 'Expires today' : `Expires in ${daysToExpiry}d`;
    return <Badge variant="warning">{label}</Badge>;
  }
  const s = STATUS_VARIANT[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Invoice/billing-period status pill (migration 057). Paid = settled,
 * Unpaid = owed (current or overdue), Upcoming = a future cycle, Void =
 * cancelled cycle. Mirrors the membership status colour language.
 */
const INVOICE_VARIANT: Record<
  InvoiceStatus,
  { label: string; variant: 'success' | 'warning' | 'info' | 'neutral' }
> = {
  paid: { label: 'Paid', variant: 'success' },
  unpaid: { label: 'Unpaid', variant: 'warning' },
  upcoming: { label: 'Upcoming', variant: 'info' },
  void: { label: 'Void', variant: 'neutral' },
  no_charge: { label: 'No charge', variant: 'neutral' },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_VARIANT[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * The PAYMENT axis of a billing period (the invoice table's "Payment"
 * column + the invoice dialog's summary row) — kept separate from the
 * cycle's lifecycle pill (Current/Past/Upcoming/Void). "No charge" is
 * the neutral case: the cycle billed nothing and collected nothing (a
 * pro-rated stub from a plan change, or a zero-fee cycle), so neither
 * "Paid" nor "Due" would be true. Derive with `invoicePaymentState()`.
 */
const INVOICE_PAYMENT_VARIANT: Record<
  InvoicePaymentState,
  { label: string; variant: 'success' | 'warning' | 'neutral' }
> = {
  paid: { label: 'Paid', variant: 'success' },
  due: { label: 'Due', variant: 'warning' },
  no_charge: { label: 'No charge', variant: 'neutral' },
};

export function InvoicePaymentBadge({ state }: { state: InvoicePaymentState }) {
  const s = INVOICE_PAYMENT_VARIANT[state];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function FeeStatusBadge({ status }: { status: MembershipFeeStatus }) {
  return status === 'paid' ? (
    <Badge variant="success">Paid</Badge>
  ) : (
    <Badge variant="warning">Fee due</Badge>
  );
}

/**
 * "Voided" pill for a corrected ledger row. Surfaces the audit trail the
 * void RPC records (reason + when) as a native tooltip, so the ledger
 * answers "why is this struck through?" without a SQL query. `voidedOn`
 * comes pre-formatted from the caller's `fmt.date` (account locale).
 */
export function VoidedPaymentBadge({
  payment,
  voidedOn,
}: {
  payment: Pick<Payment, 'void_reason' | 'voided_at'>;
  voidedOn?: string | null;
}) {
  const detail = [
    voidedOn ? `Voided ${voidedOn}` : 'Voided',
    payment.void_reason?.trim() || null,
  ]
    .filter(Boolean)
    .join(': ');
  return (
    <span title={detail} className="inline-flex cursor-help">
      <Badge variant="neutral">Voided</Badge>
    </span>
  );
}

export function PaymentStatusBadge({
  payment,
  voidedOn,
}: {
  payment: Pick<Payment, 'status' | 'void_reason' | 'voided_at'>;
  voidedOn?: string | null;
}) {
  if (payment.status === 'void') {
    return <VoidedPaymentBadge payment={payment} voidedOn={voidedOn} />;
  }

  const status: Exclude<PaymentStatus, 'void'> = payment.status;
  return status === 'due' ? (
    <Badge variant="warning">Due</Badge>
  ) : (
    <Badge variant="success">Paid</Badge>
  );
}

/**
 * Plan-type pill (migration 062) — what kind of product a plan is.
 * Recurring is the default/neutral case; a fixed term reads info; a
 * session pack violet (the same "different kind of row" colour trials use).
 */
const PLAN_TYPE_VARIANT: Record<
  PlanType,
  { label: string; variant: 'neutral' | 'info' | 'violet' }
> = {
  recurring: { label: 'Recurring', variant: 'neutral' },
  non_recurring: { label: 'Fixed term', variant: 'info' },
  session_pack: { label: 'Session pack', variant: 'violet' },
};

export function PlanTypeBadge({ type }: { type: PlanType }) {
  const t = PLAN_TYPE_VARIANT[type];
  return <Badge variant={t.variant}>{t.label}</Badge>;
}

/**
 * Marks a membership row as a trial/lead (not a paying member yet).
 * Orthogonal to the status pill — a trial is `is_trial=true` on top of
 * an active/expired status — so it renders as its own violet pill.
 */
export function TrialBadge() {
  return <Badge variant="violet">Trial</Badge>;
}
