import { describe, expect, it } from 'vitest';

import {
  invoiceDocumentErrorMessage,
  invoiceDocumentErrorResponse,
} from './invoice-document-errors';

function failure(name: string, message: string) {
  return Object.assign(new Error(message), { name });
}

describe('invoice document recovery copy', () => {
  it('explains the missing name and the place to add it', () => {
    const result = invoiceDocumentErrorResponse(
      failure(
        'InvoiceDocumentConflictError',
        'Invoice customer snapshot is incomplete'
      )
    );
    expect(result).toEqual({
      status: 409,
      error:
        "Could not make the invoice PDF. Add the member's name in Profile, then try again.",
    });
    expect(
      invoiceDocumentErrorMessage(
        new Error('Invoice customer snapshot is incomplete'),
        'Fallback'
      )
    ).toBe(result?.error);
    expect(
      invoiceDocumentErrorMessage(
        new Error(
          "Could not make the invoice PDF. Add the member's name in Details, then try again."
        ),
        'Fallback'
      )
    ).toBe(result?.error);
  });

  it('uses the current invoice setup location', () => {
    expect(
      invoiceDocumentErrorResponse(
        failure(
          'InvoiceDocumentConflictError',
          'Finish Invoice details in Settings -> Payments first.'
        )
      )?.error
    ).toContain('Settings → Business details');
  });

  it('keeps authored database instructions but hides unknown SQL validation details', () => {
    const instruction =
      "Could not make the invoice PDF. Add the member's name in Profile, then try again.";
    expect(
      invoiceDocumentErrorResponse(
        failure('InvoiceDocumentConflictError', instruction)
      )?.error
    ).toBe(instruction);
    expect(
      invoiceDocumentErrorResponse(
        failure(
          'InvoiceDocumentConflictError',
          'Invoice adjustments exceed active line facts'
        )
      )?.error
    ).toBe(
      'Could not make the invoice PDF. Its saved invoice details need repair. Contact support with the invoice number.'
    );
  });

  it('asks support to repair an existing artifact instead of suggesting regeneration', () => {
    const result = invoiceDocumentErrorResponse(
      failure(
        'InvoiceDocumentIntegrityError',
        'Missing /private/account-id/file.pdf'
      )
    );
    expect(result?.status).toBe(503);
    expect(result?.error).toContain(
      'The file is missing or damaged. Contact support'
    );
    expect(result?.error).not.toContain('/private/');
  });

  it('explains a rendering rejection without exposing internal payload fields', () => {
    expect(
      invoiceDocumentErrorResponse(
        new TypeError(
          'Invalid invoice document payload: seller.address.line1 contains a script without a supported V1 font'
        )
      )
    ).toEqual({
      status: 409,
      error:
        'Could not make the invoice PDF. Some saved invoice details cannot be printed. Contact support with the invoice number.',
    });
  });

  it('retains network guidance and lets unknown server failures use an invoice-specific fallback', () => {
    expect(
      invoiceDocumentErrorMessage(new TypeError('Failed to fetch'), 'Fallback')
    ).toBe('No internet connection. Check your internet and try again.');
    expect(
      invoiceDocumentErrorMessage(
        new Error('Internal server error'),
        'Try again. Contact support with INV-000042.'
      )
    ).toBe('Try again. Contact support with INV-000042.');
    expect(
      invoiceDocumentErrorResponse(
        new Error('Secret database connection failure')
      )
    ).toBeNull();
  });
});
