import type { InvoiceDetail } from '@/components/finance/invoice-detail-dialog';
import type { Invoice } from '@/types';
import { financeInvoiceReference } from './invoices';

/** Shared projection from the authoritative balance view into invoice detail. */
export function invoiceDetailFromBalance(invoice: Invoice): InvoiceDetail {
  return {
    id: invoice.id,
    reference: financeInvoiceReference(invoice),
    invoice_number: invoice.invoice_number,
    seller_snapshot: invoice.seller_snapshot,
    customer_snapshot: invoice.customer_snapshot,
    source: invoice.source,
    created_at: invoice.issued_at,
    fee_amount: Number(invoice.total),
    amount_paid: Number(invoice.amount_paid),
    credit_applied: Number(invoice.credit_applied),
    balance: Number(invoice.balance),
    gross_amount_paid: Number(invoice.gross_amount_paid),
    processed_refund_amount: Number(invoice.processed_refund_amount),
    invoice_adjustment_amount: Number(invoice.invoice_adjustment_amount),
    accounting_balance: Number(invoice.accounting_balance),
    collectible_balance: Number(invoice.collectible_balance),
    requires_refund_review: Boolean(invoice.requires_refund_review),
    state: invoice.state,
  };
}
