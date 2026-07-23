import { describe, expect, it } from 'vitest';

import type { FinancePaymentRow } from './payments';
import {
  financePaymentRecordedBy,
  financePaymentReference,
  financePaymentsCsv,
  normalizeFinancePaymentPage,
} from './payments';

function payment(
  overrides: Partial<FinancePaymentRow> = {}
): FinancePaymentRow {
  return {
    id: '12345678-1234-1234-1234-123456789abc',
    account_id: 'account-1',
    membership_id: 'membership-1',
    contact_id: 'contact-1',
    plan_id: 'plan-1',
    user_id: 'user-1',
    amount: 2_000,
    method: 'upi',
    status: 'paid',
    paid_at: '2026-07-23T06:00:00.000Z',
    source: 'manual',
    created_at: '2026-07-23T06:00:00.000Z',
    reference: '#12345678',
    member_number: 1001,
    contact_name: 'Aarav Shah',
    contact_phone: '9876543210',
    contact_avatar_url: null,
    plan_name: 'Strength',
    recorded_by_name: 'Riya Singh',
    ...overrides,
  };
}

describe('finance payment normalization', () => {
  it('normalizes numeric RPC values and fills every collection method', () => {
    const result = normalizeFinancePaymentPage({
      rows: [payment()],
      summary: {
        count: '2',
        collectedCount: '1',
        collected: '2000',
        voidedCount: '1',
        voidedAmount: '500',
        autopay: '0',
        methodMix: [{ method: 'upi', payments: '1', amount: '2000' }],
      },
      facets: { all: '2', collected: '1', autopay: '0', voided: '1' },
    });

    expect(result.summary).toMatchObject({
      count: 2,
      collected: 2_000,
      voidedAmount: 500,
    });
    expect(result.summary.methodMix).toEqual([
      { method: 'upi', payments: 1, amount: 2_000 },
      { method: 'cash', payments: 0, amount: 0 },
      { method: 'card', payments: 0, amount: 0 },
      { method: 'bank_other', payments: 0, amount: 0 },
    ]);
    expect(result.facets.voided).toBe(1);
  });

  it('returns safe empty values for a missing RPC body', () => {
    const result = normalizeFinancePaymentPage(null);
    expect(result.rows).toEqual([]);
    expect(result.summary.count).toBe(0);
    expect(result.facets).toEqual({
      all: 0,
      collected: 0,
      autopay: 0,
      voided: 0,
    });
  });
});

describe('finance payment identity and export', () => {
  it('uses a stable internal payment reference', () => {
    expect(financePaymentReference(payment().id)).toBe('#12345678');
  });

  it('labels gateway payments as Auto-pay even without a recorder', () => {
    expect(
      financePaymentRecordedBy(
        payment({ source: 'auto', user_id: null, recorded_by_name: null })
      )
    ).toBe('Auto-pay');
  });

  it('exports member, gateway, audit, and financial context', () => {
    const csv = financePaymentsCsv(
      [
        payment({
          gateway_payment_id: 'pay_123',
          note: 'July renewal, paid',
        }),
      ],
      () => '23 Jul 2026, 11:30'
    );

    expect(csv).toContain('Payment,Gateway reference,Member ID,Name');
    expect(csv).toContain(
      '#12345678,pay_123,1001,Aarav Shah,9876543210,Strength'
    );
    expect(csv).toContain('"July renewal, paid"');
    expect(csv).not.toContain('screenshot_path');
  });
});
