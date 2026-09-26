import type { Payment, PaymentRefund, PaymentRefundStatus } from '@/types';
import {
  invoicePaymentState,
  isChargeableAmount,
} from '@/lib/memberships/periods';

export interface InvoiceFinancialSnapshot {
  state: 'open' | 'void';
  fee_amount: number;
  amount_paid: number;
  credit_applied?: number | null;
  balance: number;
  gross_amount_paid?: number | null;
  processed_refund_amount?: number | null;
  invoice_adjustment_amount?: number | null;
  accounting_balance?: number | null;
  requires_refund_review?: boolean | null;
}

export interface InvoiceResolvableActionState {
  show: boolean;
  pending: boolean;
  blocker: 'permission' | 'refund_review' | 'line_target_required' | null;
}

const HIDDEN_INVOICE_ACTION: InvoiceResolvableActionState = {
  show: false,
  pending: false,
  blocker: null,
};

export function invoiceCollectionActionState(
  invoice: InvoiceFinancialSnapshot & { collectible_balance?: number | null },
  permitted: boolean
): InvoiceResolvableActionState {
  const balance = invoice.requires_refund_review
    ? Number(invoice.accounting_balance ?? invoice.balance)
    : Number(invoice.collectible_balance ?? invoice.balance);
  const applicable =
    invoice.state === 'open' &&
    isChargeableAmount(invoice.fee_amount) &&
    isChargeableAmount(balance);

  if (!applicable) return HIDDEN_INVOICE_ACTION;
  if (!permitted) {
    return { show: true, pending: false, blocker: 'permission' };
  }
  return {
    show: true,
    pending: false,
    blocker: invoice.requires_refund_review ? 'refund_review' : null,
  };
}

function isGatewayPayment(payment: Payment): boolean {
  return Boolean(
    payment.gateway_payment_id &&
    (payment.source === 'auto' || payment.source === 'payment_link')
  );
}

export function invoiceRefundActionState(
  payment: Payment,
  refunds: PaymentRefund[],
  refundScanComplete: boolean,
  permitted: boolean
): InvoiceResolvableActionState {
  const applicable =
    payment.status === 'paid' &&
    isGatewayPayment(payment) &&
    isChargeableAmount(payment.amount);
  if (!applicable) return HIDDEN_INVOICE_ACTION;
  if (!refundScanComplete) {
    return { show: true, pending: true, blocker: null };
  }

  const capacityUsed = refunds
    .filter((refund) => refund.status !== 'failed')
    .reduce((total, refund) => total + Number(refund.amount), 0);
  if (!isChargeableAmount(Number(payment.amount) - capacityUsed)) {
    return HIDDEN_INVOICE_ACTION;
  }
  if (!permitted) {
    return { show: true, pending: false, blocker: 'permission' };
  }
  const needsLineTarget = refunds.some(
    (refund) => refund.status === 'processed' && !refund.allocation_complete
  );
  return {
    show: true,
    pending: false,
    blocker: needsLineTarget ? 'line_target_required' : null,
  };
}

export function invoiceVoidActionState(
  payment: Payment,
  permitted: boolean
): InvoiceResolvableActionState {
  const applicable =
    payment.status === 'paid' &&
    payment.source !== 'auto' &&
    payment.source !== 'payment_link' &&
    !payment.gateway_payment_id;
  if (!applicable) return HIDDEN_INVOICE_ACTION;
  return {
    show: true,
    pending: false,
    blocker: permitted ? null : 'permission',
  };
}

export type InvoiceHeadlineDetail =
  | 'refund_review'
  | 'void'
  | 'balance_due'
  | 'balance_reopened'
  | 'settled'
  | 'nothing_to_collect';

export interface InvoiceHeadlinePresentation {
  label:
    'Balance' | 'Invoice total' | 'Balance due' | 'Paid in full';
  amount: number;
  detail: InvoiceHeadlineDetail;
}

export interface InvoiceSummaryRow {
  key:
    | 'invoice_total'
    | 'invoice_adjustment'
    | 'credit_applied'
    | 'collection'
    | 'balance';
  label: string;
  amount: number;
  sign?: 'minus';
  emphasis?: boolean;
  warning?: boolean;
  collectionBreakdown?: {
    gross: number;
    refunded: number;
  };
}

export type InvoiceDocumentStatus = 'generating' | 'ready' | 'failed' | null;

export interface InvoiceDocumentActionFacts {
  is_projected: boolean;
  lifecycle?: 'current' | 'past' | 'upcoming' | 'void' | null;
  state: 'open' | 'void';
  requires_refund_review?: boolean | null;
  seller_snapshot: object | null;
  customer_snapshot: object | null;
  document_status: InvoiceDocumentStatus;
  has_customer_phone: boolean;
  whatsapp_connected: boolean;
  template_ready: boolean;
}

export type InvoiceDocumentBlockerCode =
  | 'void'
  | 'refund_review'
  | 'invoice_profile'
  | 'document_preparing'
  | 'missing_phone'
  | 'whatsapp_disconnected'
  | 'template_unavailable';

export interface InvoiceDocumentActionState {
  show: boolean;
  enabled: boolean;
  reason: string | null;
  blocker: InvoiceDocumentBlockerCode | null;
}

export interface InvoiceDocumentActionPresentation {
  download: InvoiceDocumentActionState;
  share: InvoiceDocumentActionState;
}

const INVOICE_PROFILE_RECOVERY =
  'Add your invoice details in Settings → Payments first.';
const VOID_DOCUMENT_RECOVERY = 'Cancelled invoices cannot be made into a PDF';
const REFUND_REVIEW_RECOVERY =
  'Sort out the refund before making the invoice PDF';
const DOCUMENT_PREPARING_RECOVERY =
  'The invoice PDF is already being made. Try again in a minute.';
const PHONE_RECOVERY = 'Add a phone number before sending on WhatsApp.';
const WHATSAPP_RECOVERY = 'Connect WhatsApp in Settings before sending.';
const TEMPLATE_RECOVERY =
  'Get the invoice message approved by WhatsApp before sending.';

/**
 * The single owner of invoice-document action readiness and recovery copy.
 * Both actions intentionally read the same immutable/current facts so the
 * dialog never explains one state differently from another surface.
 */
export function invoiceDocumentActionPresentation(
  facts: InvoiceDocumentActionFacts
): InvoiceDocumentActionPresentation {
  if (facts.is_projected) {
    const hidden = {
      show: false,
      enabled: false,
      reason: null,
      blocker: null,
    } as const;
    return { download: hidden, share: hidden };
  }

  const ready = facts.document_status === 'ready';
  const profileComplete = Boolean(
    facts.seller_snapshot && facts.customer_snapshot
  );
  const generationBlock =
    facts.state === 'void'
      ? VOID_DOCUMENT_RECOVERY
      : facts.requires_refund_review
        ? REFUND_REVIEW_RECOVERY
        : !profileComplete
          ? INVOICE_PROFILE_RECOVERY
          : facts.document_status === 'generating'
            ? DOCUMENT_PREPARING_RECOVERY
            : null;
  const generationBlocker: InvoiceDocumentBlockerCode | null =
    facts.state === 'void'
      ? 'void'
      : facts.requires_refund_review
        ? 'refund_review'
        : !profileComplete
          ? 'invoice_profile'
          : facts.document_status === 'generating'
            ? 'document_preparing'
            : null;
  const shareBlock =
    facts.state === 'void'
      ? VOID_DOCUMENT_RECOVERY
      : facts.requires_refund_review
        ? REFUND_REVIEW_RECOVERY
        : !profileComplete
          ? INVOICE_PROFILE_RECOVERY
          : !facts.has_customer_phone
            ? PHONE_RECOVERY
            : !facts.whatsapp_connected
              ? WHATSAPP_RECOVERY
              : !facts.template_ready
                ? TEMPLATE_RECOVERY
                : facts.document_status === 'generating'
                  ? DOCUMENT_PREPARING_RECOVERY
                  : null;
  const shareBlocker: InvoiceDocumentBlockerCode | null =
    facts.state === 'void'
      ? 'void'
      : facts.requires_refund_review
        ? 'refund_review'
        : !profileComplete
          ? 'invoice_profile'
          : !facts.has_customer_phone
            ? 'missing_phone'
            : !facts.whatsapp_connected
              ? 'whatsapp_disconnected'
              : !facts.template_ready
                ? 'template_unavailable'
                : facts.document_status === 'generating'
                  ? 'document_preparing'
                  : null;

  return {
    download: {
      show: true,
      enabled: ready || generationBlock === null,
      reason: ready ? null : generationBlock,
      blocker: ready ? null : generationBlocker,
    },
    share: {
      show: true,
      enabled: shareBlock === null,
      reason: shareBlock,
      blocker: shareBlocker,
    },
  };
}

export function invoiceHeadline(
  invoice: InvoiceFinancialSnapshot
): InvoiceHeadlinePresentation {
  if (invoice.requires_refund_review) {
    return {
      label: 'Balance',
      amount: Number(invoice.accounting_balance ?? invoice.balance),
      detail: 'refund_review',
    };
  }

  if (invoice.state === 'void') {
    return {
      label: 'Invoice total',
      amount: Number(invoice.fee_amount),
      detail: 'void',
    };
  }

  if (isChargeableAmount(invoice.balance)) {
    return {
      label: 'Balance due',
      amount: Number(invoice.balance),
      detail: isChargeableAmount(invoice.processed_refund_amount ?? 0)
        ? 'balance_reopened'
        : 'balance_due',
    };
  }

  const paymentState = invoicePaymentState(invoice);
  if (paymentState === 'paid') {
    return {
      label: 'Paid in full',
      amount: Number(invoice.fee_amount),
      detail: 'settled',
    };
  }

  return {
    label: 'Invoice total',
    amount: Number(invoice.fee_amount),
    detail: 'nothing_to_collect',
  };
}

export function invoiceSummaryRows(
  invoice: InvoiceFinancialSnapshot
): InvoiceSummaryRow[] {
  const adjustment = Number(invoice.invoice_adjustment_amount ?? 0);
  const credit = Number(invoice.credit_applied ?? 0);
  const netCollected = Number(invoice.amount_paid ?? 0);
  const grossCollected = Number(
    invoice.gross_amount_paid ?? invoice.amount_paid ?? 0
  );
  const refunded = Number(invoice.processed_refund_amount ?? 0);
  const balance = invoice.requires_refund_review
    ? Number(invoice.accounting_balance ?? invoice.balance)
    : invoice.state === 'void'
      ? 0
      : Number(invoice.balance);

  const rows: InvoiceSummaryRow[] = [
    {
      key: 'invoice_total',
      label: 'Invoice total',
      amount: Number(invoice.fee_amount),
    },
  ];

  if (isChargeableAmount(adjustment)) {
    rows.push({
      key: 'invoice_adjustment',
      label: 'Bill reduced',
      amount: adjustment,
      sign: 'minus',
    });
  }

  if (isChargeableAmount(credit)) {
    rows.push({
      key: 'credit_applied',
      label: 'Credit used',
      amount: credit,
      sign: 'minus',
    });
  }

  if (
    isChargeableAmount(grossCollected) ||
    isChargeableAmount(netCollected) ||
    isChargeableAmount(refunded)
  ) {
    rows.push({
      key: 'collection',
      label: isChargeableAmount(refunded) ? 'Money received' : 'Collected',
      amount: netCollected,
      collectionBreakdown: isChargeableAmount(refunded)
        ? { gross: grossCollected, refunded }
        : undefined,
    });
  }

  rows.push({
    key: 'balance',
    label: invoice.requires_refund_review
      ? 'Balance'
      : 'Balance due',
    amount: balance,
    emphasis: true,
    warning:
      invoice.requires_refund_review || isChargeableAmount(Number(balance)),
  });

  return rows;
}

export const PAYMENT_REFUND_STATUS_PRESENTATION: Record<
  PaymentRefundStatus,
  {
    label: string;
    variant: 'success' | 'danger' | 'warning';
    eventLabel: 'Processed' | 'Failed' | 'Requested';
  }
> = {
  creating: {
    label: 'Refund starting',
    variant: 'warning',
    eventLabel: 'Requested',
  },
  pending: {
    label: 'Refund pending',
    variant: 'warning',
    eventLabel: 'Requested',
  },
  processed: {
    label: 'Refunded',
    variant: 'success',
    eventLabel: 'Processed',
  },
  failed: {
    label: 'Refund failed',
    variant: 'danger',
    eventLabel: 'Failed',
  },
  orphaned: {
    label: 'Refund needs checking',
    variant: 'danger',
    eventLabel: 'Requested',
  },
};

export function paymentRefundOutcome(refund: PaymentRefund): string {
  if (refund.disposition === 'reopen_balance') return 'Amount due again';
  if (refund.disposition === 'reduce_charge') return 'Bill reduced';
  if (refund.status === 'processed') {
    return refund.allocation_complete
      ? 'Needs sorting out'
      : 'Needs splitting across items';
  }
  if (refund.status === 'failed') return 'Balance not changed';
  if (refund.status === 'orphaned') return 'Needs checking by hand';
  if (refund.status === 'creating') return 'Sending to Razorpay';
  return 'Waiting for Razorpay';
}

export function paymentRefundEventAt(refund: PaymentRefund): string {
  if (refund.status === 'processed') {
    return (
      refund.processed_at ?? refund.provider_created_at ?? refund.requested_at
    );
  }
  if (refund.status === 'failed') {
    return refund.failed_at ?? refund.requested_at;
  }
  return refund.requested_at;
}
