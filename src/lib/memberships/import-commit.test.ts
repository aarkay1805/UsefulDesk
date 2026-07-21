import { describe, expect, it } from 'vitest';

import {
  applyMemberMapping,
  autoMapMemberColumns,
  buildMembershipRow,
  MEMBER_IGNORE_KEY,
  parseBoolean,
  parseFeeStatus,
  parseHeightCm,
  parseImportDate,
  parseMembershipStatus,
  parseMoney,
  parsePaymentMethod,
  parseWeightKg,
  resolvePlan,
  resolvePricingOption,
  validateMemberMapping,
  type MemberImportRow,
} from './import-commit';
import type { MembershipPlan } from '@/types';

function opt(
  id: string,
  planId: string,
  count: number,
  unit: 'day' | 'week' | 'month' | 'year',
  price: number
) {
  return {
    id,
    account_id: 'a1',
    plan_id: planId,
    duration_count: count,
    duration_unit: unit,
    price,
    setup_fee: 500,
    is_active: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  };
}

const PLANS = [
  {
    id: 'p-gold',
    name: 'Gold',
    price: 1500,
    duration_days: 30,
    plan_type: 'recurring',
    pricing_options: [
      opt('o-month', 'p-gold', 1, 'month', 1500),
      opt('o-quarter', 'p-gold', 3, 'month', 4000),
    ],
  },
  {
    id: 'p-bare',
    name: 'Bare',
    price: 0,
    duration_days: 30,
    plan_type: 'recurring',
    pricing_options: [],
  },
] as unknown as MembershipPlan[];

const TODAY = '2026-07-11';

function memberRow(patch: Partial<MemberImportRow> = {}): MemberImportRow {
  return {
    phone: '919876543210',
    name: 'Asha',
    planName: 'Gold',
    tagNames: [],
    customValues: [],
    ...patch,
  };
}

describe('member column mapping', () => {
  it('maps vendor synonyms, punctuation, separators, and camelCase', () => {
    expect(
      autoMapMemberColumns([
        'MemberFullName',
        'WhatsApp_No',
        'Membership Package',
        'validUntil',
        'D.O.B.',
        'Amount Paid',
        'State',
        'Mystery',
      ])
    ).toEqual([
      'name',
      'phone',
      'plan',
      'end_date',
      'date_of_birth',
      'amount_paid',
      'state',
      MEMBER_IGNORE_KEY,
    ]);
  });

  it('assigns each target once and requires Phone plus Plan', () => {
    expect(autoMapMemberColumns(['Phone', 'Mobile', 'Package'])).toEqual([
      'phone',
      MEMBER_IGNORE_KEY,
      'plan',
    ]);
    expect(validateMemberMapping(['phone', 'plan']).ok).toBe(true);
    expect(validateMemberMapping(['phone', 'name']).ok).toBe(false);
    expect(validateMemberMapping(['phone', 'plan', 'plan']).ok).toBe(false);
  });
});

describe('applyMemberMapping', () => {
  it('qualifies local phones, preserves explicit international numbers, and dedupes', () => {
    const result = applyMemberMapping(
      [
        ['Asha', '98765 43210', 'Gold'],
        ['Asha again', '+91 98765 43210', 'Gold'],
        ['Jo', '+44 7700 900123', 'Gold'],
        ['Empty', '', 'Gold'],
        ['Broken', '123', 'Gold'],
      ],
      ['name', 'phone', 'plan'],
      { dialCode: '+91' }
    );
    expect(result.rows.map((row) => row.phone)).toEqual([
      '919876543210',
      '447700900123',
    ]);
    expect(result.skippedDuplicate).toBe(1);
    expect(result.skippedNoPhone).toBe(1);
    expect(result.skippedInvalidPhone).toBe(1);
  });

  it('maps tags and typed custom fields while counting invalid values', () => {
    const result = applyMemberMapping(
      [['9876543210', 'Gold', 'VIP; Morning', '42', 'not-a-date']],
      ['phone', 'plan', 'tags', 'custom:score', 'custom:joined'],
      {
        dialCode: '+91',
        dateOrder: 'DMY',
        customFieldTypes: new Map([
          ['score', 'number'],
          ['joined', 'date'],
        ]),
      }
    );
    expect(result.rows[0].tagNames).toEqual(['VIP', 'Morning']);
    expect(result.rows[0].customValues).toEqual([
      { fieldId: 'score', value: '42' },
    ]);
    expect(result.invalidCustomValues).toBe(1);
  });
});

describe('date and value coercion', () => {
  it('accepts ISO timestamps, DMY/MDY, month names, compact and Excel dates', () => {
    expect(parseImportDate('2026-07-01T13:15:00Z')).toBe('2026-07-01');
    expect(parseImportDate('01/07/2026', 'DMY')).toBe('2026-07-01');
    expect(parseImportDate('07/01/2026', 'MDY')).toBe('2026-07-01');
    expect(parseImportDate('15 Jun 2026')).toBe('2026-06-15');
    expect(parseImportDate('June 15, 2026')).toBe('2026-06-15');
    expect(parseImportDate('20260701')).toBe('2026-07-01');
    expect(parseImportDate('45292')).toBe('2024-01-01');
  });

  it('rejects impossible dates and accepts common money formats', () => {
    expect(parseImportDate('31/02/2026')).toBeNull();
    expect(parseImportDate('soon')).toBeNull();
    expect(parseMoney('₹1,500')).toBe(1500);
    expect(parseMoney('1.500,50')).toBe(1500.5);
    expect(parseMoney('1,500.50')).toBe(1500.5);
    expect(parseMoney('1.500')).toBe(1500);
    expect(parseMoney('(500)')).toBeNull();
  });

  it('normalizes statuses, payment methods, booleans, height, and weight', () => {
    expect(parseMembershipStatus('inactive').status).toBe('cancelled');
    expect(parseMembershipStatus('on hold').status).toBe('frozen');
    expect(parseFeeStatus('settled')).toBe('paid');
    expect(parsePaymentMethod('Google Pay')).toBe('upi');
    expect(parsePaymentMethod('NEFT transfer')).toBe('bank');
    expect(parseBoolean('At risk')).toBe(true);
    expect(parseHeightCm('5\'10"')).toBe(177.8);
    expect(parseWeightKg('176 lb')).toBe(79.8);
  });
});

describe('plan resolution', () => {
  it('matches exact and contained plan names plus billing aliases', () => {
    const plan = resolvePlan('Gold Monthly', PLANS);
    expect(plan?.id).toBe('p-gold');
    expect(resolvePricingOption(plan!, 'Quarterly')?.id).toBe('o-quarter');
  });

  it('does not guess an unknown plan', () => {
    expect(resolvePlan('Diamond', PLANS)).toBeNull();
  });
});

describe('buildMembershipRow', () => {
  it('derives dates and fee from the chosen option without setup fee', () => {
    const built = buildMembershipRow(memberRow(), PLANS, 'DMY', TODAY);
    expect(built.errors).toEqual([]);
    expect(built.membership).toEqual({
      plan_id: 'p-gold',
      pricing_option_id: 'o-month',
      start_date: TODAY,
      end_date: '2026-08-11',
      status: 'active',
      frozen_at: null,
      fee_amount: 1500,
      notes: null,
    });
    expect(built.payment).toBeNull();
  });

  it('turns paid input into a real payment payload instead of fee-status data', () => {
    const built = buildMembershipRow(
      memberRow({
        pricingOption: 'Quarterly',
        startDate: '15/06/2026',
        endDate: '14/09/2026',
        fee: '₹4,000',
        feeStatus: 'paid',
        paymentMethod: 'PhonePe',
        paidAt: '15 Jun 2026',
      }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.membership?.fee_amount).toBe(4000);
    expect(built.membership).not.toHaveProperty('fee_status');
    expect(built.payment).toEqual({
      amount: 4000,
      method: 'upi',
      paidOn: '2026-06-15',
    });
  });

  it('supports partial payments and profile-unit conversion', () => {
    const built = buildMembershipRow(
      memberRow({
        fee: '4000',
        amountPaid: '2000',
        paymentMethod: 'cash',
        height: '5\'10"',
        weight: '176 lb',
      }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.payment?.amount).toBe(2000);
    expect(built.contact.height_cm).toBe(177.8);
    expect(built.contact.weight_kg).toBe(79.8);
  });

  it('keeps a cancelled paid history row eligible for a real ledger payment', () => {
    const built = buildMembershipRow(
      memberRow({ status: 'inactive', feeStatus: 'paid' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.membership?.status).toBe('cancelled');
    expect(built.payment).toEqual({
      amount: 1500,
      method: 'other',
      paidOn: TODAY,
    });
  });

  it('blocks unknown plans, impossible dates, overpayment, and unpriced plans', () => {
    expect(
      buildMembershipRow(
        memberRow({ planName: 'Diamond' }),
        PLANS,
        'DMY',
        TODAY
      ).errors
    ).toContain('unknown-plan');
    expect(
      buildMembershipRow(
        memberRow({ startDate: '31/02/2026' }),
        PLANS,
        'DMY',
        TODAY
      ).errors
    ).toContain('bad-date');
    expect(
      buildMembershipRow(
        memberRow({ fee: '1000', amountPaid: '2000' }),
        PLANS,
        'DMY',
        TODAY
      ).errors
    ).toContain('payment-exceeds-fee');
    expect(
      buildMembershipRow(memberRow({ planName: 'Bare' }), PLANS, 'DMY', TODAY)
        .errors
    ).toContain('no-pricing');
  });
});
