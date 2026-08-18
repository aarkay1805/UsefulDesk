import { describe, expect, it } from 'vitest';

import {
  autoMapMemberColumns,
  buildMembershipRow,
  coerceTrainer,
  resolveImportedPricing,
  type MemberImportRow,
} from './import-commit';
import { buildMemberImportCandidates } from './member-import-candidates';
import {
  MEMBER_IMPORT_FIELDS,
  MEMBER_IMPORT_GROUP_ORDER,
  MEMBER_TABLE_COLUMNS,
} from './member-field-registry';
import type { MembershipPlan } from '@/types';

const PLANS = [
  {
    id: 'p-gold',
    name: 'Gold',
    plan_type: 'recurring',
    is_active: true,
    pricing_options: [
      {
        id: 'o-month',
        plan_id: 'p-gold',
        duration_count: 1,
        duration_unit: 'month',
        price: 1500,
        setup_fee: 0,
        is_active: true,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  },
] as unknown as MembershipPlan[];

const TODAY = '2026-07-11';

function row(overrides: Partial<MemberImportRow> = {}): MemberImportRow {
  return {
    sourceRowIndex: 0,
    phone: '+919876543210',
    planName: 'Gold',
    pricingOption: '1 month',
    tagNames: [],
    customValues: [],
    ...overrides,
  };
}

describe('resolveImportedPricing', () => {
  it('derives the discount from an actual/discounted column pair', () => {
    // The shape every legacy Indian gym export ships: no discount column at
    // all, just the two prices. Losing this pair loses the entire discount.
    expect(
      resolveImportedPricing({ listPrice: '48,000', charged: '20000' }).pricing
    ).toEqual({
      listPrice: 48000,
      discountType: 'amount',
      discountValue: 28000,
      discountAmount: 28000,
      charged: 20000,
    });
  });

  it('records no discount when list and charged agree', () => {
    expect(
      resolveImportedPricing({ listPrice: '5000', charged: '5000' }).pricing
    ).toEqual({
      listPrice: 5000,
      discountType: null,
      discountValue: null,
      discountAmount: 0,
      charged: 5000,
    });
  });

  it('reconstructs the list price behind a percentage discount', () => {
    expect(
      resolveImportedPricing({ discountPercent: '25', charged: '9000' }).pricing
    ).toEqual({
      listPrice: 12000,
      discountType: 'percentage',
      discountValue: 25,
      discountAmount: 3000,
      charged: 9000,
    });
  });

  it('keeps a percentage exact to the paise so the CHECK constraint holds', () => {
    // membership_periods_discount_values_valid recomputes
    // ROUND(list_price * discount_value / 100, 2) and rejects any drift, so
    // an awkward percentage has to land on a whole paise or not be used.
    for (const percent of ['33.33', '12.5', '7', '66.67', '99.99']) {
      const pricing = resolveImportedPricing({
        discountPercent: percent,
        charged: '12000',
      }).pricing;
      expect(pricing).not.toBeNull();
      expect(pricing?.charged).toBe(12000);
      const listPaise = Math.round((pricing?.listPrice ?? 0) * 100);
      const discountPaise = Math.round((pricing?.discountAmount ?? 0) * 100);
      expect(listPaise - discountPaise).toBe(1200000);
      if (pricing?.discountType === 'percentage') {
        const hundredths = Math.round((pricing.discountValue ?? 0) * 100);
        expect(discountPaise).toBe(
          Math.floor((listPaise * hundredths) / 10000 + 0.5)
        );
      }
    }
  });

  it('derives the list price from a flat discount', () => {
    expect(
      resolveImportedPricing({ discountAmount: '6000', charged: '12000' })
        .pricing
    ).toEqual({
      listPrice: 18000,
      discountType: 'amount',
      discountValue: 6000,
      discountAmount: 6000,
      charged: 12000,
    });
  });

  it('accepts all three amounts when they reconcile', () => {
    expect(
      resolveImportedPricing({
        listPrice: '18000',
        discountAmount: '6000',
        charged: '12000',
      }).errors
    ).toEqual([]);
  });

  it('refuses three amounts that do not reconcile', () => {
    const result = resolveImportedPricing({
      listPrice: '18000',
      discountAmount: '5000',
      charged: '12000',
    });
    expect(result.pricing).toBeNull();
    expect(result.errors).toContain('pricing-mismatch');
  });

  it('rejects a discount larger than the list price', () => {
    const result = resolveImportedPricing({
      listPrice: '5000',
      discountAmount: '9000',
    });
    expect(result.pricing).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range or doubled-up discount', () => {
    expect(
      resolveImportedPricing({ discountPercent: '140', charged: '100' }).errors
    ).toContain('bad-discount');
    expect(
      resolveImportedPricing({
        discountPercent: '10',
        discountAmount: '10',
        charged: '100',
      }).errors
    ).toContain('bad-discount');
  });

  it('falls back to the configured price when the file has no money', () => {
    expect(resolveImportedPricing({ fallbackCharged: 3000 }).pricing).toEqual({
      listPrice: 3000,
      discountType: null,
      discountValue: null,
      discountAmount: 0,
      charged: 3000,
    });
  });
});

describe('buildMembershipRow pricing snapshot', () => {
  it('carries the discount onto the membership payload', () => {
    const built = buildMembershipRow(
      row({ listPrice: '18000', fee: '12000' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.errors).toEqual([]);
    expect(built.membership).toMatchObject({
      fee_amount: 12000,
      list_price: 18000,
      discount_type: 'amount',
      discount_value: 6000,
      discount_amount: 6000,
    });
  });

  it('blocks a row whose amounts contradict each other', () => {
    const built = buildMembershipRow(
      row({ listPrice: '18000', discountAmount: '5000', fee: '12000' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.errors).toContain('pricing-mismatch');
    expect(built.membership).toBeNull();
  });
});

describe('legacy gym export headers', () => {
  const HEADERS = [
    'MEMBER ID',
    'MEMBER NAME',
    'CONTACT',
    'MEMBERSHIP',
    'START DATE',
    'END DATE',
    'BALANCE',
    'STATUS',
    'TRAINER',
    'ACTUAL AMT',
    'DISCOUNTED AMT',
    'PAID AMP',
  ];

  it('maps every money column from the header alone, with no recipe', () => {
    // Regression: these four used to fall to "Don't import" whenever the
    // owner pressed Auto map or skipped Analyze, silently importing every
    // member at plan list price with no payment.
    const mapping = autoMapMemberColumns(HEADERS, []);
    expect(Object.fromEntries(HEADERS.map((h, i) => [h, mapping[i]]))).toEqual({
      'MEMBER ID': 'legacy_member_id',
      'MEMBER NAME': 'name',
      CONTACT: 'phone',
      MEMBERSHIP: 'membership_plan',
      'START DATE': 'start_date',
      'END DATE': 'end_date',
      BALANCE: 'amount_due',
      STATUS: 'status',
      TRAINER: 'membership_trainer',
      'ACTUAL AMT': 'membership_list_price',
      'DISCOUNTED AMT': 'fee_amount',
      'PAID AMP': 'amount_paid',
    });
  });

  it('separates a percentage column from a flat discount column', () => {
    // Both normalize to "discount" once punctuation is stripped.
    const mapping = autoMapMemberColumns(
      ['Discount %', 'Discount amount', 'Service discount %'],
      []
    );
    expect(mapping).toEqual([
      'membership_discount_percent',
      'membership_discount_amount',
      'service_discount_percent',
    ]);
  });
});

describe('mapping picker vocabulary', () => {
  it('gives every field a group that the picker renders', () => {
    for (const item of MEMBER_IMPORT_FIELDS) {
      expect(MEMBER_IMPORT_GROUP_ORDER).toContain(item.group);
    }
  });

  it('keeps membership fields ahead of their service twins', () => {
    // autoMapColumns claims the first unused match, so a bare "Start date"
    // must reach the membership before the service can take it.
    const position = (key: string) =>
      MEMBER_IMPORT_FIELDS.findIndex((item) => item.key === key);
    for (const [membership, service] of [
      ['start_date', 'service_start'],
      ['end_date', 'service_end'],
      ['status', 'service_status'],
      ['membership_list_price', 'service_list_price'],
      ['membership_discount_amount', 'service_discount_amount'],
      ['membership_discount_percent', 'service_discount_percent'],
      ['fee_amount', 'service_sold_price'],
    ]) {
      expect(position(membership)).toBeLessThan(position(service));
    }
  });

  it('never repeats a label inside one group', () => {
    const seen = new Map<string, Set<string>>();
    for (const item of MEMBER_IMPORT_FIELDS) {
      const labels = seen.get(item.group) ?? new Set<string>();
      const label = item.groupLabel ?? item.label;
      expect(labels.has(label)).toBe(false);
      labels.add(label);
      seen.set(item.group, labels);
    }
  });
});

describe('member trainer identity', () => {
  const ROSTER = [
    { id: 't-mohit', display_name: 'Mohit', is_active: true },
    { id: 't-anand', display_name: 'Anand kumar', is_active: true },
    { id: 't-old', display_name: 'Retired Coach', is_active: false },
  ];

  it('resolves a gym trainer who has no platform login', () => {
    // The whole point of trainer_id: assigned_to is FK -> auth.users, so
    // these names could never resolve through the staff roster.
    expect(coerceTrainer('Mohit', ROSTER)).toBe('t-mohit');
    expect(coerceTrainer('  anand KUMAR ', ROSTER)).toBe('t-anand');
    expect(coerceTrainer('Anand', ROSTER)).toBe('t-anand');
  });

  it('never guesses an inactive, unknown, or ambiguous trainer', () => {
    expect(coerceTrainer('Retired Coach', ROSTER)).toBeNull();
    expect(coerceTrainer('Nobody', ROSTER)).toBeNull();
    expect(
      coerceTrainer('A', [
        { id: 't1', display_name: 'Aakash', is_active: true },
        { id: 't2', display_name: 'Anita', is_active: true },
      ])
    ).toBeNull();
  });

  it('puts the resolved trainer on the contact, not on assigned_to', () => {
    const built = buildMembershipRow(
      row({ membershipTrainer: 'Mohit' }),
      PLANS,
      'DMY',
      TODAY,
      [],
      ROSTER
    );
    expect(built.contact.trainer_id).toBe('t-mohit');
    expect(built.assignedTo).toBeNull();
    expect(built.warnings).toEqual([]);
  });

  it('warns instead of silently dropping an unknown trainer', () => {
    const built = buildMembershipRow(
      row({ membershipTrainer: 'Ghost' }),
      PLANS,
      'DMY',
      TODAY,
      [],
      ROSTER
    );
    expect(built.contact.trainer_id).toBeNull();
    expect(built.warnings).toContain('unknown-trainer');
  });

  it('keeps a bare Trainer column on the membership, not the service', () => {
    // service_trainer no longer claims it, so a membership-only export no
    // longer loses its trainer to a service that does not exist.
    expect(autoMapMemberColumns(['Trainer'], [])).toEqual([
      'membership_trainer',
    ]);
    expect(autoMapMemberColumns(['Service trainer'], [])).toEqual([
      'service_trainer',
    ]);
    expect(autoMapMemberColumns(['Trainer', 'Service trainer'], [])).toEqual([
      'membership_trainer',
      'service_trainer',
    ]);
  });
});

describe('members table column contract', () => {
  it('ships Trainer visible and Assigned to hidden but re-addable', () => {
    const trainer = MEMBER_TABLE_COLUMNS.find((c) => c.key === 'trainer');
    const assignee = MEMBER_TABLE_COLUMNS.find((c) => c.key === 'assignee');
    expect(trainer?.defaultHidden).toBeFalsy();
    // Still declared, so the column controls can restore it — its cell is
    // also where a pending lead-assignment request and Withdraw surface.
    expect(assignee).toBeDefined();
    expect(assignee?.defaultHidden).toBe(true);
  });

  it('routes each people field to exactly one column', () => {
    const owner = new Map<string, string>();
    for (const column of MEMBER_TABLE_COLUMNS) {
      if (column.importPolicy.kind !== 'fields') continue;
      for (const key of column.importPolicy.fields) {
        if (
          key === 'assigned_to' ||
          key === 'membership_trainer' ||
          key === 'service_trainer'
        ) {
          expect(owner.has(key)).toBe(false);
          owner.set(key, column.key);
        }
      }
    }
    expect(owner.get('assigned_to')).toBe('assignee');
    expect(owner.get('membership_trainer')).toBe('trainer');
    expect(owner.get('service_trainer')).toBe('assignee');
  });
});

describe('membership date range', () => {
  it('imports a same-day row as the one-day membership it really is', () => {
    // Per-session and day-pass rows repeat one date in both columns because
    // the source cannot express a duration. 12 rows in the reference file.
    const built = buildMembershipRow(
      row({ startDate: '01/06/2026', endDate: '01/06/2026' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.errors).toEqual([]);
    expect(built.membership).toMatchObject({
      start_date: '2026-06-01',
      end_date: '2026-06-02',
    });
  });

  it('still blocks an expiry that precedes its start', () => {
    // perform_member_import_group raises "Membership expiry must be after
    // start", and a customer group is one transaction — so a row the preview
    // calls ready but the database rejects aborts every row for that member.
    const built = buildMembershipRow(
      row({ startDate: '01/06/2026', endDate: '31/05/2026' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.errors).toContain('expiry-not-after-start');
  });

  it('accepts a one-day membership, which is what a day pass really is', () => {
    const built = buildMembershipRow(
      row({ startDate: '01/06/2026', endDate: '02/06/2026' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.errors).toEqual([]);
    expect(built.membership).toMatchObject({
      start_date: '2026-06-01',
      end_date: '2026-06-02',
    });
  });

  it('leaves a derived expiry alone', () => {
    // No explicit end date: the option term supplies it, and a 1-month term
    // is never same-day, so the new guard must not fire.
    const built = buildMembershipRow(
      row({ startDate: '01/06/2026' }),
      PLANS,
      'DMY',
      TODAY
    );
    expect(built.errors).toEqual([]);
    expect(built.membership?.end_date).toBe('2026-07-01');
  });
});

describe('same-day rows and the duration notice', () => {
  const SESSION = [
    {
      id: 'p-day',
      name: 'Single Session',
      plan_type: 'non_recurring',
      is_active: true,
      pricing_options: [
        {
          id: 'o-day',
          plan_id: 'p-day',
          duration_count: 1,
          duration_unit: 'day',
          price: 2000,
          setup_fee: 0,
          is_active: true,
          sort_order: 0,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    },
  ] as unknown as MembershipPlan[];

  function issuesFor(
    plans: MembershipPlan[],
    values: Partial<MemberImportRow>
  ) {
    const [candidate] = buildMemberImportCandidates(
      [
        {
          sourceKey: 'csv:2',
          sourceRow: 2,
          originalValues: { ...row(), ...values },
        },
      ],
      { plans, dateOrder: 'DMY', today: TODAY }
    );
    return {
      codes: candidate.issues.map((issue) => issue.code),
      membership: candidate.built.membership,
    };
  }

  it('stays quiet when a one-day plan really is one day', () => {
    const { codes, membership } = issuesFor(SESSION, {
      planName: 'Single Session',
      pricingOption: '1 day',
      startDate: '15/08/2026',
      endDate: '15/08/2026',
      fee: '2000',
    });
    expect(membership?.end_date).toBe('2026-08-16');
    expect(codes).not.toContain('expiry-duration-mismatch');
  });

  it('still flags a six-month plan recorded as a single day', () => {
    // Almost certainly a source data-entry error, and the row that most
    // deserves a human look — so it must not be lost among per-session rows.
    const { codes, membership } = issuesFor(PLANS, {
      startDate: '01/06/2026',
      endDate: '01/06/2026',
      fee: '1500',
    });
    expect(membership?.end_date).toBe('2026-06-02');
    expect(codes).toContain('expiry-duration-mismatch');
  });
});
