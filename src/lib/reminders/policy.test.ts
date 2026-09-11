import { describe, expect, it } from 'vitest';

import {
  isCoveredByActiveMandate,
  isCollectibleInvoice,
  selectDueMilestone,
  requiresAutoPayReconciliation,
  shouldSuppressGeneralPreDue,
} from './policy';

describe('selectDueMilestone', () => {
  it('selects only the latest eligible unhandled milestone inside catch-up', () => {
    expect(
      selectDueMilestone({
        anchorDate: '2026-09-10',
        today: '2026-09-13',
        activatedOn: '2026-09-01',
        milestones: [
          { key: 'late-1', offsetDays: 1 },
          { key: 'late-3', offsetDays: 3 },
        ],
        handledKeys: [],
        catchUpDays: 2,
      })
    ).toEqual({ key: 'late-3', offsetDays: 3 });
  });

  it('never selects a milestone that predates activation', () => {
    expect(
      selectDueMilestone({
        anchorDate: '2026-09-10',
        today: '2026-09-13',
        activatedOn: '2026-09-13',
        milestones: [{ key: 'late-1', offsetDays: 1 }],
        handledKeys: [],
        catchUpDays: 2,
      })
    ).toBeNull();
  });

  it('supersedes older milestones when the newest one has already been handled', () => {
    expect(
      selectDueMilestone({
        anchorDate: '2026-09-10',
        today: '2026-09-13',
        activatedOn: '2026-09-01',
        milestones: [
          { key: 'late-1', offsetDays: 1 },
          { key: 'late-3', offsetDays: 3 },
        ],
        handledKeys: ['late-3'],
        catchUpDays: 2,
      })
    ).toBeNull();
  });
});

describe('invoice collection eligibility', () => {
  it.each([
    [{ state: 'open', balance: 0, requiresRefundReview: false }, false],
    [{ state: 'open', balance: -1, requiresRefundReview: false }, false],
    [{ state: 'void', balance: 20, requiresRefundReview: false }, false],
    [{ state: 'open', balance: 20, requiresRefundReview: true }, false],
    [{ state: 'open', balance: 20, requiresRefundReview: false }, true],
  ] as const)('uses only collectible invoice balances: %o', (invoice, expected) => {
    expect(isCollectibleInvoice(invoice)).toBe(expected);
  });

  it('lets the fixed installment own every general invoice milestone for its invoice', () => {
    expect(
      shouldSuppressGeneralPreDue({
        invoiceId: 'invoice-1',
        milestone: { key: 'due', offsetDays: 0 },
        installmentInvoiceIds: new Set(['invoice-1']),
      })
    ).toBe(true);
    expect(
      shouldSuppressGeneralPreDue({
        invoiceId: 'invoice-2',
        milestone: { key: 'before-3', offsetDays: -3 },
        installmentInvoiceIds: new Set(['invoice-1']),
      })
    ).toBe(false);
    expect(
      shouldSuppressGeneralPreDue({
        invoiceId: 'invoice-1',
        milestone: { key: 'overdue-1', offsetDays: 1 },
        installmentInvoiceIds: new Set(['invoice-1']),
      })
    ).toBe(true);
  });

  it('limits AutoPay suppression to the membership actually covered by a live mandate', () => {
    const activeMandateMembershipIds = new Set(['membership-covered']);
    expect(
      isCoveredByActiveMandate({
        membershipId: 'membership-covered',
        activeMandateMembershipIds,
      })
    ).toBe(true);
    expect(
      isCoveredByActiveMandate({
        membershipId: 'membership-other',
        activeMandateMembershipIds,
      })
    ).toBe(false);
    expect(
      isCoveredByActiveMandate({
        membershipId: null,
        activeMandateMembershipIds,
      })
    ).toBe(false);
  });

  it('holds a live-mandate membership line for reconciliation without suppressing unrelated lines', () => {
    expect(
      requiresAutoPayReconciliation({
        activeMandateMembershipIds: new Set(['membership-1']),
        lineMembershipIds: ['membership-1', null],
      })
    ).toBe(true);
    expect(
      requiresAutoPayReconciliation({
        activeMandateMembershipIds: new Set(['membership-1']),
        lineMembershipIds: [null, 'membership-2'],
      })
    ).toBe(false);
  });
});
