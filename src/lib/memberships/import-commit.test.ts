import { describe, expect, it } from 'vitest';

import {
  applyMemberMapping,
  applyMemberMappingPreservingRows,
  autoMapMemberColumns,
  buildMemberImportReceiptRows,
  buildMembershipRow,
  commitMemberImportCandidates,
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
  serializeMemberImportReceiptCsv,
  validateMemberMapping,
  type MemberImportCommitResult,
  type MemberImportRow,
} from './import-commit';
import type { MemberImportCandidate } from './member-import-candidates';
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
      'membership_plan',
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
      'offering',
    ]);
    expect(validateMemberMapping(['phone', 'plan']).ok).toBe(true);
    expect(validateMemberMapping(['phone', 'name']).ok).toBe(false);
    expect(validateMemberMapping(['phone', 'plan', 'plan']).ok).toBe(false);
  });

  it('maps explicit and ambiguous offering headers without forcing membership', () => {
    expect(autoMapMemberColumns(['Package'])).toEqual(['offering']);
    expect(autoMapMemberColumns(['Offering'])).toEqual(['offering']);
    expect(autoMapMemberColumns(['Membership plan'])).toEqual([
      'membership_plan',
    ]);
    expect(autoMapMemberColumns(['Service'])).toEqual(['service']);
    expect(validateMemberMapping(['phone', 'service']).ok).toBe(true);
    expect(validateMemberMapping(['phone', 'offering']).ok).toBe(true);
    expect(validateMemberMapping(['phone']).ok).toBe(false);
  });
});

describe('applyMemberMapping', () => {
  it('retains missing, invalid, and duplicate phones for candidate resolution', () => {
    const result = applyMemberMappingPreservingRows(
      [
        ['Asha', '', 'Gold'],
        ['Jo', '123', 'Gold'],
        ['Mina', '98765 43210', 'Gold'],
        ['Ravi', '98765 43210', 'Gold'],
      ],
      ['name', 'phone', 'plan'],
      { dialCode: '+91' }
    );

    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => row.phone)).toEqual([
      '',
      '91123',
      '919876543210',
      '919876543210',
    ]);
  });

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
    expect(parseImportDate('21-Jul-2026')).toBe('2026-07-21');
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

describe('cancelled membership dues', () => {
  // `set_membership_cancellation` voids the current period, so an unpaid
  // balance on a cancelled row is erased at commit. The row still imports;
  // the warning is what stops the write-off being silent.
  it('warns when a cancelled membership still carries a balance', () => {
    const built = buildMembershipRow(
      memberRow({ status: 'cancelled', fee: '7000', amountPaid: '0' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.membership?.status).toBe('cancelled');
    expect(built.warnings).toContain('cancelled-dues-written-off');
    expect(built.errors).toEqual([]);
  });

  it('warns when a cancelled membership is only part paid', () => {
    const built = buildMembershipRow(
      memberRow({ status: 'cancelled', fee: '4000', amountPaid: '1500' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.warnings).toContain('cancelled-dues-written-off');
  });

  it('stays quiet when a cancelled membership is settled', () => {
    const built = buildMembershipRow(
      memberRow({ status: 'cancelled', fee: '4000', feeStatus: 'paid' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.warnings).not.toContain('cancelled-dues-written-off');
  });

  it('stays quiet when an unpaid membership is not cancelled', () => {
    const built = buildMembershipRow(
      memberRow({ status: 'active', fee: '7000', amountPaid: '0' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.warnings).not.toContain('cancelled-dues-written-off');
  });

  // The balance is compared in whole paise, so two-decimal arithmetic cannot
  // leave a fraction behind and invent a write-off that is not there.
  it('does not invent a balance from float drift', () => {
    const built = buildMembershipRow(
      memberRow({ status: 'cancelled', fee: '1500.10', amountPaid: '1500.10' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.warnings).not.toContain('cancelled-dues-written-off');
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
      list_price: 1500,
      discount_type: null,
      discount_value: null,
      discount_amount: 0,
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

function commitCandidate(
  patch: Partial<MemberImportCandidate> = {}
): MemberImportCandidate {
  const built = buildMembershipRow(memberRow(), PLANS, 'DMY', TODAY);
  return {
    sourceKey: 'sheet-1:2',
    sourceRow: 2,
    legacyMemberId: 'LEG-002',
    originalValues: memberRow(),
    draftValues: memberRow(),
    disposition: 'included',
    isReady: true,
    existingMatch: null,
    issues: [],
    exclusionReason: null,
    resolutions: {
      plan: null,
      payment: 'member_only',
      existingContact: null,
    },
    built,
    membershipComponent: {
      included: true,
      exclusionReason: null,
      membership: built.membership,
    },
    serviceComponent: null,
    outcomeKind: 'membership',
    customerGroupKey: 'phone:15550000002:legacy:leg-002',
    customerIdempotencyKey: '19058c37-e846-4f7e-86a4-b9e63307ed2d',
    purchaseIdempotencyKey: 'db5990d1-476a-4078-b17c-c3a4b09a06cb',
    purchaseTotal: 1200,
    receiptOutcome: null,
    ...patch,
  };
}

describe('candidate-aware member import commit', () => {
  it('only executes included ready candidates and reports excluded and unresolved rows', async () => {
    const calls: string[] = [];
    const results = await commitMemberImportCandidates(
      [
        commitCandidate({ sourceRow: 1, disposition: 'excluded' }),
        commitCandidate({ sourceRow: 2, isReady: false }),
        commitCandidate({ sourceRow: 3 }),
      ],
      {
        createContact: async () => {
          calls.push('contact');
          return { contactId: 'contact-3' };
        },
        createMembership: async () => {
          calls.push('member');
          return { membershipId: 'member-3' };
        },
        recordPayment: async () => {
          calls.push('payment');
        },
      }
    );

    expect(calls).toEqual(['contact', 'member']);
    expect(results).toEqual([
      expect.objectContaining({
        sourceRowIndex: 1,
        disposition: 'excluded',
        memberOutcome: 'not-processed',
        paymentOutcome: 'not-processed',
        reason: 'candidate-excluded',
      }),
      expect.objectContaining({
        sourceRowIndex: 2,
        disposition: 'unresolved',
        memberOutcome: 'not-processed',
        paymentOutcome: 'not-processed',
        reason: 'candidate-unresolved',
      }),
      expect.objectContaining({
        sourceRowIndex: 3,
        disposition: 'imported',
        memberOutcome: 'created',
        paymentOutcome: 'not-requested',
        reason: 'member-only-import',
      }),
    ]);
  });

  it('retains a successful member outcome when its payment write fails', async () => {
    const built = buildMembershipRow(
      memberRow({ amountPaid: '1500' }),
      PLANS,
      'DMY',
      TODAY
    );
    const results = await commitMemberImportCandidates(
      [commitCandidate({ built })],
      {
        createContact: async () => ({ contactId: 'contact-1' }),
        createMembership: async () => ({ membershipId: 'member-1' }),
        recordPayment: async () => {
          throw new Error('ledger unavailable');
        },
      }
    );

    expect(results[0]).toEqual(
      expect.objectContaining({
        disposition: 'partial',
        memberOutcome: 'created',
        paymentOutcome: 'failed',
        reason: 'ledger unavailable',
      })
    );
  });

  it('attaches an existing contact and distinguishes an intentional member-only import', async () => {
    const calls: string[] = [];
    const results = await commitMemberImportCandidates(
      [
        commitCandidate({
          existingMatch: { contactId: 'existing-contact', isMember: false },
          resolutions: {
            plan: null,
            payment: 'member_only',
            existingContact: 'use_csv',
          },
        }),
      ],
      {
        attachExistingContact: async (contactId: string) => {
          calls.push(`attach:${contactId}`);
        },
        createMembership: async () => {
          calls.push('member');
          return { membershipId: 'member-1' };
        },
        recordPayment: async () => {
          calls.push('payment');
        },
      }
    );

    expect(calls).toEqual(['attach:existing-contact', 'member']);
    expect(results[0]).toEqual(
      expect.objectContaining({
        disposition: 'imported',
        memberOutcome: 'attached',
        paymentOutcome: 'not-requested',
        reason: 'member-only-import',
      })
    );
  });

  it('accepts the canonical included and ready candidate shape from resolution', async () => {
    const calls: string[] = [];
    const results = await commitMemberImportCandidates(
      [
        commitCandidate({
          sourceKey: 'sheet-1:20',
          sourceRow: 20,
          legacyMemberId: 'M-20',
          existingMatch: { contactId: 'existing-contact', isMember: false },
          resolutions: {
            plan: null,
            payment: 'member_only',
            existingContact: 'use_csv',
          },
        }),
      ],
      {
        attachExistingContact: async (contactId: string) => {
          calls.push(`attach:${contactId}`);
        },
        createMembership: async () => {
          calls.push('member');
          return { membershipId: 'member-20' };
        },
      }
    );

    expect(calls).toEqual(['attach:existing-contact', 'member']);
    expect(results[0]).toEqual(
      expect.objectContaining({
        sourceRowIndex: 20,
        memberOutcome: 'attached',
        paymentOutcome: 'not-requested',
      })
    );
  });

  it('leaves a committed row reason blank instead of stamping a failure', () => {
    // A committed row reports reason: null. `??` used to fall through to the
    // not-committed fallback, so every imported row in a real receipt read
    // "candidate-not-committed" beside outcomes that all said created.
    const rows = buildMemberImportReceiptRows(
      [
        commitCandidate({
          sourceRow: 2,
          legacyMemberId: '279',
          originalValues: memberRow({ phone: '+919988883715' }),
          draftValues: memberRow({ phone: '+919988883715' }),
        }),
      ],
      [
        {
          sourceRowIndex: 2,
          disposition: 'imported',
          memberOutcome: 'created',
          paymentOutcome: 'recorded',
          reason: null,
          contactId: 'contact-2',
          membershipId: 'membership-2',
        },
      ]
    );
    expect(rows[0]).toMatchObject({
      disposition: 'imported',
      customer_outcome: 'created',
      payment_outcome: 'recorded',
      reason: '',
    });
  });

  it('still explains a row that never reached the commit boundary', () => {
    const rows = buildMemberImportReceiptRows(
      [
        commitCandidate({
          sourceRow: 9,
          originalValues: memberRow({ phone: '+919888790808' }),
          draftValues: memberRow({ phone: '+919888790808' }),
          isReady: false,
        }),
      ],
      []
    );
    expect(rows[0]).toMatchObject({
      disposition: 'unresolved',
      reason: 'candidate-unresolved',
    });
  });

  it('builds ordered, redacted receipt rows and escapes the CSV safely', () => {
    const candidates = [
      commitCandidate({
        sourceRow: 12,
        legacyMemberId: 'LEG,"12"',
        originalValues: memberRow({ phone: '+91 98765 43210' }),
        draftValues: memberRow({ phone: '+91 98765 43210' }),
      }),
      commitCandidate({
        sourceRow: 4,
        legacyMemberId: 'LEG-004',
        originalValues: memberRow({ phone: '447700900123' }),
        draftValues: memberRow({ phone: '447700900123' }),
        disposition: 'excluded',
      }),
    ];
    const results: MemberImportCommitResult[] = [
      {
        sourceRowIndex: 12,
        disposition: 'partial',
        memberOutcome: 'created',
        paymentOutcome: 'failed',
        reason: 'payment, provider said "retry"',
        contactId: 'contact-12',
        membershipId: 'membership-12',
      },
      {
        sourceRowIndex: 4,
        disposition: 'excluded',
        memberOutcome: 'not-processed',
        paymentOutcome: 'not-processed',
        reason: 'candidate-excluded',
        contactId: null,
        membershipId: null,
      },
    ];

    const rows = buildMemberImportReceiptRows(candidates, results);

    expect(rows).toEqual([
      {
        source_row: 4,
        legacy_id: 'LEG-004',
        phone_suffix: '0123',
        outcome_type: 'membership',
        offering_name: 'Gold',
        disposition: 'excluded',
        customer_outcome: 'not-processed',
        membership_outcome: 'not-processed',
        service_outcome: 'not-requested',
        invoice_outcome: 'not-processed',
        member_outcome: 'not-processed',
        payment_outcome: 'not-processed',
        reason: 'candidate-excluded',
      },
      {
        source_row: 12,
        legacy_id: 'LEG,"12"',
        phone_suffix: '3210',
        outcome_type: 'membership',
        offering_name: 'Gold',
        disposition: 'partial',
        customer_outcome: 'created',
        membership_outcome: 'created',
        service_outcome: 'not-requested',
        invoice_outcome: 'created',
        member_outcome: 'created',
        payment_outcome: 'failed',
        reason: 'payment, provider said "retry"',
      },
    ]);
    expect(serializeMemberImportReceiptCsv(rows)).toBe(
      'source_row,legacy_id,phone_suffix,outcome_type,offering_name,disposition,customer_outcome,membership_outcome,service_outcome,invoice_outcome,member_outcome,payment_outcome,reason\n' +
        '4,LEG-004,0123,membership,Gold,excluded,not-processed,not-processed,not-requested,not-processed,not-processed,not-processed,candidate-excluded\n' +
        '12,"LEG,""12""",3210,membership,Gold,partial,created,created,not-requested,created,created,failed,"payment, provider said ""retry"""'
    );
  });
});
