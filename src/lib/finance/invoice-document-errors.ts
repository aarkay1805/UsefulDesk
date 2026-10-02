import { getErrorMessage } from '@/lib/errors';

const REPAIR_DETAILS =
  'Could not make the invoice PDF. Its saved invoice details need repair. Contact support with the invoice number.';

/** Plain recovery copy shared by document download, WhatsApp sharing and toasts. */
export function invoiceDocumentErrorMessage(
  error: unknown,
  fallback: string
): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Invoice customer snapshot is incomplete') {
    return "Could not make the invoice PDF. Add the member's name in Details, then try again.";
  }
  if (/^Finish Invoice details in Settings/.test(message)) {
    return 'Could not make the invoice PDF. Complete Invoice details in Settings → Business details, then try again.';
  }
  if (message === 'Voided invoices cannot generate documents') {
    return 'Could not make the invoice PDF. This invoice was cancelled.';
  }
  if (
    message === 'Resolve the invoice refund review before generating a document'
  ) {
    return 'Could not make the invoice PDF. Sort out the refund in this invoice, then try again.';
  }
  if (
    error instanceof Error &&
    error.name === 'InvoiceDocumentPreparingError'
  ) {
    return 'The invoice PDF is already being made. Try again in a minute.';
  }
  if (
    message.startsWith('Invoice document generation is already in progress')
  ) {
    return 'The invoice PDF is already being made. Try again in a minute.';
  }
  if (
    error instanceof Error &&
    error.name === 'InvoiceDocumentIntegrityError'
  ) {
    return 'Could not open the saved invoice PDF. The file is missing or damaged. Contact support with the invoice number.';
  }
  if (message.startsWith('Invalid invoice document payload:')) {
    return 'Could not make the invoice PDF. Some saved invoice details cannot be printed. Contact support with the invoice number.';
  }
  if (error instanceof Error && error.name === 'InvoiceDocumentConflictError') {
    // Only the database's deliberately authored recovery messages may pass
    // through. Other SQL validation text belongs in operator logs.
    return message.startsWith('Could not make the invoice PDF.')
      ? message
      : REPAIR_DETAILS;
  }
  return getErrorMessage(error, fallback);
}

export function invoiceDocumentErrorResponse(
  error: unknown
): { error: string; status: 409 | 503 } | null {
  if (!(error instanceof Error)) return null;
  if (
    error.name === 'InvoiceDocumentConflictError' ||
    error.name === 'InvoiceDocumentPreparingError' ||
    error.message.startsWith('Invalid invoice document payload:')
  ) {
    return {
      error: invoiceDocumentErrorMessage(error, REPAIR_DETAILS),
      status: 409,
    };
  }
  if (error.name === 'InvoiceDocumentIntegrityError') {
    return {
      error: invoiceDocumentErrorMessage(error, REPAIR_DETAILS),
      status: 503,
    };
  }
  return null;
}
