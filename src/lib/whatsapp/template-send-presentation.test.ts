import { describe, expect, it } from 'vitest';

import type { InvoiceDocumentPayloadV1 } from '@/lib/finance/invoice-documents';
import { invoiceDocumentTemplateParams } from './template-send-presentation';

const payload: InvoiceDocumentPayloadV1 = {
  format_version: 1,
  invoice_number: 'INV-000042',
  issued_at: '2026-08-24',
  currency: 'INR',
  seller: {
    business_name: 'FitZone Gym',
    legal_name: 'Live Legal Name Must Not Be Read',
    branch_name: 'Live Branch Must Not Be Read',
    phone: null,
    email: null,
    address: {
      line1: '1 Gym Road',
      line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postal_code: '411001',
      country: 'India',
    },
  },
  customer: {
    customer_name: 'Asha',
    member_number: '1001',
    phone: '+919999999999',
    email: null,
    address: {
      line1: null,
      line2: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
    },
  },
  lines: [
    {
      description: 'Monthly membership',
      period: null,
      quantity: 1,
      unit_amount_minor: 250000,
      amount_minor: 250000,
    },
  ],
  subtotal_minor: 250000,
  adjustments_minor: 0,
  total_minor: 250000,
};

describe('invoiceDocumentTemplateParams', () => {
  it('uses only immutable invoice facts and exact-money output for the document send', () => {
    const signedUrl = 'https://storage.example/signed-invoice.pdf?token=short';

    expect(
      invoiceDocumentTemplateParams(payload, signedUrl, {
        moneyExact: (value, currency) =>
          `${currency}:${value.toFixed(2)} exact`,
      })
    ).toEqual({
      headerMediaUrl: signedUrl,
      body: ['Asha', 'INV-000042', 'INR:2500.00 exact', 'FitZone Gym'],
    });
  });
});
