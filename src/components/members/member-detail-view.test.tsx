// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { memberInvoiceDetail, revealMemberBilling } from './member-detail-view';
import { SERVICE_CUSTOMER_SECTIONS } from './service-customer-detail-view';

afterEach(() => {
  document.body.innerHTML = '';
});

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

describe('member billing resolution', () => {
  it('scrolls the existing Billing section below the sticky nav and focuses its heading', () => {
    const scrollRoot = document.createElement('div');
    const billingSection = document.createElement('section');
    const billingHeading = document.createElement('div');
    billingHeading.tabIndex = -1;
    billingSection.appendChild(billingHeading);
    scrollRoot.appendChild(billingSection);
    document.body.appendChild(scrollRoot);

    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 120,
    });
    scrollRoot.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    billingSection.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
    const scrollTo = vi.fn();
    scrollRoot.scrollTo = scrollTo;

    revealMemberBilling({
      scrollRoot,
      billingSection,
      billingHeading,
      navHeight: 36,
      reducedMotion: true,
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 484, behavior: 'auto' });
    expect(document.activeElement).toBe(billingHeading);
  });
});
