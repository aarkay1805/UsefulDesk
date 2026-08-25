import { describe, expect, it } from 'vitest';

import { memberInvoiceDetail } from './member-detail-view';
import { SERVICE_CUSTOMER_SECTIONS } from './service-customer-detail-view';

describe('service customer detail', () => {
  it('keeps contact-backed service, billing, and follow-up sections', () => {
    expect(SERVICE_CUSTOMER_SECTIONS).toEqual(['products', 'billing', 'notes']);
  });
});

describe('member invoice presentation', () => {
  it('uses the immutable human number in member billing and detail', () => {
    expect(
      memberInvoiceDetail({
        id: '12345678-1234-4234-9234-123456789abc',
        account_id: 'account-1',
        contact_id: 'contact-1',
        membership_id: 'membership-1',
        membership_period_id: 'period-1',
        source: 'joining',
        state: 'open',
        issued_at: '2026-08-24T00:00:00.000Z',
        customer_name_snapshot: 'Asha',
        member_number_snapshot: 1001,
        currency: 'INR',
        created_by: 'user-1',
        created_at: '2026-08-24T00:00:00.000Z',
        voided_at: null,
        voided_by: null,
        void_reason: null,
        total: 2_500,
        amount_paid: 0,
        credit_applied: 0,
        balance: 2_500,
        invoice_sequence: 42,
        invoice_number: 'INV-000042',
        seller_snapshot: null,
        customer_snapshot: null,
        identity_snapshot_version: 1,
      }).reference
    ).toBe('INV-000042');
  });
});
