import type { PaymentRefund, PaymentRefundStatus } from '@/types';
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

export type InvoiceHeadlineDetail =
  | 'refund_review'
  | 'void'
  | 'balance_due'
  | 'balance_reopened'
  | 'settled'
  | 'nothing_to_collect';

export interface InvoiceHeadlinePresentation {
  label:
    'Accounting balance' | 'Invoice total' | 'Balance due' | 'Paid in full';
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

export function invoiceHeadline(
  invoice: InvoiceFinancialSnapshot
): InvoiceHeadlinePresentation {
  if (invoice.requires_refund_review) {
    return {
      label: 'Accounting balance',
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
      label: 'Charge adjustment',
      amount: adjustment,
      sign: 'minus',
    });
  }

  if (isChargeableAmount(credit)) {
    rows.push({
      key: 'credit_applied',
      label: 'Credit applied',
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
      label: isChargeableAmount(refunded) ? 'Net collected' : 'Collected',
      amount: netCollected,
      collectionBreakdown: isChargeableAmount(refunded)
        ? { gross: grossCollected, refunded }
        : undefined,
    });
  }

  rows.push({
    key: 'balance',
    label: invoice.requires_refund_review
      ? 'Accounting balance'
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
    label: 'Refund needs review',
    variant: 'danger',
    eventLabel: 'Requested',
  },
};

export function paymentRefundOutcome(refund: PaymentRefund): string {
  if (refund.disposition === 'reopen_balance') return 'Balance reopened';
  if (refund.disposition === 'reduce_charge') return 'Charge reduced';
  if (refund.status === 'processed') {
    return refund.allocation_complete
      ? 'Classification required'
      : 'Line targeting required';
  }
  if (refund.status === 'failed') return 'No balance changed';
  if (refund.status === 'orphaned') return 'Manual review required';
  if (refund.status === 'creating') return 'Sending to Razorpay';
  return 'Awaiting Razorpay';
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
