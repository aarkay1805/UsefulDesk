import { describe, expect, it } from 'vitest';
import {
  assertInvoiceDocumentPayload,
  invoiceDocumentFilename,
  invoiceDocumentRoute,
  type InvoiceDocumentPayloadV1,
} from './invoice-documents';

const address = Object.freeze({
  line1: '12 Fitness Road',
  line2: null,
  city: 'Pune',
  state: 'Maharashtra',
  postal_code: '411001',
  country: 'India',
});

const line = Object.freeze({
  description: 'Annual strength membership',
  period: '2026-08-24 to 2027-08-23',
  quantity: 1,
  unit_amount_minor: 250_000,
  amount_minor: 250_000,
});

const validPayload: Readonly<InvoiceDocumentPayloadV1> = Object.freeze({
  format_version: 1,
  invoice_number: 'INV-000042',
  issued_at: '2026-08-24',
  currency: 'INR',
  seller: Object.freeze({
    business_name: 'शक्ति फिटनेस',
    legal_name: 'Shakti Fitness Private Limited',
    branch_name: 'Koregaon Park',
    phone: '+91 20 5555 0101',
    email: 'hello@example.com',
    address,
  }),
  customer: Object.freeze({
    customer_name: 'अनन्या देशमुख',
    member_number: '1042',
    phone: '+91 98765 43210',
    email: 'ananya@example.com',
    address,
  }),
  lines: Object.freeze([line]),
  subtotal_minor: 250_000,
  adjustments_minor: -5_000,
  total_minor: 245_000,
});

describe('invoice document locations', () => {
  it('builds a stable human filename and removes path/control characters', () => {
    expect(invoiceDocumentFilename('INV-000042')).toBe(
      'invoice-INV-000042.pdf'
    );
    expect(invoiceDocumentFilename('../../INV 000042/\u0000₹')).toBe(
      'invoice-INV-000042.pdf'
    );
  });

  it('builds a stable encoded application route', () => {
    const invoiceId = '11111111-1111-4111-8111-111111111111';

    expect(invoiceDocumentRoute(invoiceId)).toBe(
      `/api/invoices/${invoiceId}/document`
    );
    expect(invoiceDocumentRoute('../another invoice')).toBe(
      '/api/invoices/..%2Fanother%20invoice/document'
    );
  });
});

describe('assertInvoiceDocumentPayload', () => {
  it('accepts a complete, reconciled V1 charge snapshot', () => {
    expect(() => assertInvoiceDocumentPayload(validPayload)).not.toThrow();
  });

  it.each([
    ['balance_minor', 0],
    ['paid_minor', 245_000],
    ['payment', { method: 'cash' }],
    ['refund', { amount_minor: 100 }],
    ['contact', { id: 'live-contact' }],
    ['credits_minor', 0],
    ['membership', { id: 'live-membership' }],
  ])('rejects mutable or live key %s', (key, value) => {
    expect(() =>
      assertInvoiceDocumentPayload({ ...validPayload, [key]: value })
    ).toThrow(/mutable|unsupported/i);
  });

  it('rejects mutable facts even when hidden in a nested snapshot', () => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        customer: {
          ...validPayload.customer,
          contact: { id: 'live-contact' },
        },
      })
    ).toThrow(/mutable|unsupported/i);
  });

  it.each([
    ['line amount', 24_999.5, 'amount_minor'],
    ['unit amount', Number.MAX_SAFE_INTEGER + 1, 'unit_amount_minor'],
  ])('rejects a non-safe-integer %s', (_name, amount, field) => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        lines: [{ ...line, [field]: amount }],
      })
    ).toThrow(/safe integer/i);
  });

  it('rejects a non-safe-integer summary amount', () => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        subtotal_minor: 250_000.1,
      })
    ).toThrow(/safe integer/i);
  });

  it('rejects a subtotal that does not equal the integer line sum', () => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        subtotal_minor: 249_999,
        total_minor: 244_999,
      })
    ).toThrow(/line amounts.*subtotal/i);
  });

  it('rejects a total that does not equal subtotal plus adjustments', () => {
    expect(() =>
      assertInvoiceDocumentPayload({ ...validPayload, total_minor: 250_000 })
    ).toThrow(/subtotal.*adjustments.*total/i);
  });

  it.each([
    [
      'seller business name',
      { seller: { ...validPayload.seller, business_name: ' ' } },
    ],
    [
      'seller address line',
      {
        seller: {
          ...validPayload.seller,
          address: { ...validPayload.seller.address, line1: null },
        },
      },
    ],
    [
      'seller city',
      {
        seller: {
          ...validPayload.seller,
          address: { ...validPayload.seller.address, city: '' },
        },
      },
    ],
    [
      'seller country',
      {
        seller: {
          ...validPayload.seller,
          address: { ...validPayload.seller.address, country: null },
        },
      },
    ],
    [
      'customer name',
      { customer: { ...validPayload.customer, customer_name: '' } },
    ],
    [
      'customer address shape',
      {
        customer: {
          ...validPayload.customer,
          address: { ...validPayload.customer.address, postal_code: undefined },
        },
      },
    ],
  ])('rejects an incomplete %s snapshot', (_name, override) => {
    expect(() =>
      assertInvoiceDocumentPayload({ ...validPayload, ...override })
    ).toThrow(/seller|customer|address/i);
  });

  it('rejects unsupported versions, malformed dates, and empty lines', () => {
    expect(() =>
      assertInvoiceDocumentPayload({ ...validPayload, format_version: 2 })
    ).toThrow(/format_version/i);
    expect(() =>
      assertInvoiceDocumentPayload({ ...validPayload, issued_at: '24/08/2026' })
    ).toThrow(/issued_at/i);
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        lines: [],
        subtotal_minor: 0,
        adjustments_minor: 0,
        total_minor: 0,
      })
    ).toThrow(/lines/i);
  });

  it('rejects text that can exceed the V1 render frame', () => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        lines: [{ ...line, description: 'x'.repeat(321) }],
      })
    ).toThrow(/description.*320/i);
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        lines: [{ ...line, period: 'x'.repeat(121) }],
      })
    ).toThrow(/period.*120/i);
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        seller: {
          ...validPayload.seller,
          business_name: 'x'.repeat(101),
        },
      })
    ).toThrow(/business_name.*100/i);
  });

  it('rejects individually valid party fields whose combined block is too tall', () => {
    const repeated = 'x'.repeat(80);

    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        seller: {
          business_name: repeated,
          legal_name: repeated,
          branch_name: repeated,
          phone: repeated,
          email: repeated,
          address: {
            line1: repeated,
            line2: repeated,
            city: repeated,
            state: repeated,
            postal_code: repeated,
            country: repeated,
          },
        },
      })
    ).toThrow(/seller.*combined.*480/i);
  });

  it('rejects control characters and scripts without a registered V1 font', () => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        lines: [{ ...line, description: 'first line\nsecond line' }],
      })
    ).toThrow(/control/i);
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        customer: {
          ...validPayload.customer,
          customer_name: '健身会员',
        },
      })
    ).toThrow(/script.*supported|supported.*script/i);
  });

  it.each([
    ['Bengali', 'শক্তি ফিটনেস'],
    ['Gurmukhi', 'ਸ਼ਕਤੀ ਫਿਟਨੈਸ'],
    ['Gujarati', 'શક્તિ ફિટનેસ'],
    ['Odia', 'ଶକ୍ତି ଫିଟନେସ'],
    ['Tamil', 'சக்தி உடற்பயிற்சி'],
    ['Telugu', 'శక్తి ఫిట్‌నెస్'],
    ['Kannada', 'ಶಕ್ತಿ ಫಿಟ್ನೆಸ್'],
    ['Malayalam', 'ശക്തി ഫിറ്റ്നസ്'],
  ])('accepts %s party snapshots backed by a V1 font', (_script, name) => {
    expect(() =>
      assertInvoiceDocumentPayload({
        ...validPayload,
        seller: { ...validPayload.seller, business_name: name },
      })
    ).not.toThrow();
  });
});
