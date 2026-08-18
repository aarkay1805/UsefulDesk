import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type {
  CatalogItem,
  CatalogOption,
  MembershipPlan,
  Trainer,
  TrainerRate,
} from '@/types';
import {
  buildMemberImportCandidates,
  filterMemberImportCandidates,
  patchMemberImportCandidate,
  revalidateMemberImportCandidates,
  resolveExistingContact,
  resolveGroupedPlan,
  resolvePaymentConflict,
  searchMemberImportCandidates,
  summarizeMemberImportCandidates,
  type MemberImportCandidateInput,
} from './member-import-candidates';

const TODAY = '2026-07-11';

function option(
  id: string,
  planId: string,
  count: number,
  unit: 'day' | 'week' | 'month' | 'year',
  price: number
) {
  return {
    id,
    account_id: 'account-1',
    plan_id: planId,
    duration_count: count,
    duration_unit: unit,
    price,
    setup_fee: 0,
    is_active: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  };
}

const PLANS = [
  {
    id: 'plan-gold',
    name: 'Gold',
    price: 1200,
    duration_days: 30,
    plan_type: 'recurring',
    pricing_options: [
      option('gold-month', 'plan-gold', 1, 'month', 1200),
      option('gold-quarter', 'plan-gold', 3, 'month', 3300),
    ],
  },
  {
    id: 'plan-silver',
    name: 'Silver',
    price: 900,
    duration_days: 30,
    plan_type: 'recurring',
    pricing_options: [option('silver-month', 'plan-silver', 1, 'month', 900)],
  },
] as unknown as MembershipPlan[];

const SERVICE_OPTION = {
  id: 'pt-month',
  account_id: 'account-1',
  item_id: 'service-pt',
  duration_count: 1,
  duration_unit: 'month',
  standard_price: 4_000,
  is_active: true,
  sort_order: 0,
  created_at: '',
  updated_at: '',
} satisfies CatalogOption;

const SERVICES = [
  {
    id: 'service-pt',
    account_id: 'account-1',
    kind: 'service',
    name: 'Personal training',
    description: null,
    requires_trainer: false,
    is_active: true,
    created_by: 'user-1',
    created_at: '',
    updated_at: '',
    catalog_options: [SERVICE_OPTION],
  },
] satisfies CatalogItem[];

function source(
  sourceRow: number,
  patch: Partial<MemberImportCandidateInput> & {
    original?: Partial<MemberImportCandidateInput['originalValues']>;
  } = {}
): MemberImportCandidateInput {
  const { original, ...rest } = patch;
  return {
    sourceKey: `sheet-1:${sourceRow}`,
    sourceRow,
    legacyMemberId: `M-${sourceRow}`,
    originalValues: {
      phone: `+1555000${String(sourceRow).padStart(4, '0')}`,
      name: `Sample ${sourceRow}`,
      planName: 'Gold',
      startDate: '01/01/2026',
      fee: '1200',
      amountPaid: '1200',
      tagNames: [],
      customValues: [],
      ...original,
    },
    ...rest,
  };
}

function build(
  rows: MemberImportCandidateInput[],
  serviceFacts: {
    catalogItems?: CatalogItem[];
    trainers?: Trainer[];
    trainerRates?: TrainerRate[];
    staff?: { user_id: string; full_name: string }[];
  } = {}
) {
  return buildMemberImportCandidates(rows, {
    plans: PLANS,
    catalogItems: serviceFacts.catalogItems ?? SERVICES,
    trainers: serviceFacts.trainers ?? [],
    trainerRates: serviceFacts.trainerRates ?? [],
    staff: serviceFacts.staff ?? [],
    dateOrder: 'DMY',
    today: TODAY,
  });
}

// Every `built.warnings` code needs a consumer, or the value it describes is
// dropped without the operator ever seeing it. These lock that contract in.
describe('warnings reach the operator as notices', () => {
  it('surfaces an unmatched assignee instead of dropping the name', () => {
    const [candidate] = build(
      [source(2, { original: { assignedTo: 'Ravi Kumar' } })],
      { staff: [{ user_id: 'u-1', full_name: 'Priya Nair' }] }
    );

    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: 'assignee-unmatched',
        severity: 'notice',
      })
    );
    // A notice must never stop the row importing.
    expect(candidate.isReady).toBe(true);
  });

  it('stays quiet when the assignee resolves to a teammate', () => {
    const [candidate] = build(
      [source(2, { original: { assignedTo: 'Priya Nair' } })],
      { staff: [{ user_id: 'u-1', full_name: 'Priya Nair' }] }
    );

    expect(
      candidate.issues.some((item) => item.code === 'assignee-unmatched')
    ).toBe(false);
  });

  it('surfaces an unreadable churn risk value', () => {
    const [candidate] = build([
      source(2, { original: { churnRisk: 'maybe' } }),
    ]);

    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: 'churn-risk-unmatched',
        severity: 'notice',
      })
    );
    expect(candidate.isReady).toBe(true);
  });

  it('surfaces an unreadable height or weight', () => {
    const [candidate] = build([
      source(2, { original: { height: 'tall', weight: '' } }),
    ]);

    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: 'profile-value-invalid',
        severity: 'notice',
      })
    );
    expect(candidate.isReady).toBe(true);
  });

  // A cancelled row's period is voided at commit, so its unpaid balance is
  // written off. The row still imports — the notice is what makes the money
  // leaving visible before the operator commits.
  it('warns that a cancelled member with a balance loses it on import', () => {
    const [candidate] = build([
      source(2, {
        original: { status: 'cancelled', fee: '7000', amountPaid: '0' },
      }),
    ]);

    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: 'cancelled-dues-written-off',
        severity: 'notice',
      })
    );
    expect(candidate.isReady).toBe(true);
  });

  it('stays quiet when a cancelled member owes nothing', () => {
    const [candidate] = build([
      source(2, {
        original: { status: 'cancelled', fee: '7000', amountPaid: '7000' },
      }),
    ]);

    expect(
      candidate.issues.some(
        (item) => item.code === 'cancelled-dues-written-off'
      )
    ).toBe(false);
  });
});

describe('member import candidates', () => {
  it('builds service-only and combined source rows without fabricating memberships', () => {
    const candidates = build([
      source(2, {
        original: {
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceSoldPrice: '3500',
          fee: '3500',
          amountPaid: '3500',
        },
      }),
      source(3, {
        original: {
          serviceName: 'Personal training',
          serviceOption: '1 month',
          fee: '5200',
          amountPaid: '5200',
        },
      }),
    ]);

    expect(candidates[0]).toMatchObject({
      outcomeKind: 'service',
      membershipComponent: null,
      serviceComponent: { intent: { soldAmount: 3500 } },
      isReady: true,
    });
    expect(candidates[1]).toMatchObject({
      outcomeKind: 'membership_service',
      membershipComponent: { included: true },
      serviceComponent: { intent: { soldAmount: 4000 } },
      isReady: true,
    });
  });

  it('blocks a service-only row when its explicit fee is malformed', () => {
    const [candidate] = build([
      source(2, {
        original: {
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceSoldPrice: '4000',
          fee: 'not money',
        },
      }),
    ]);

    expect(candidate.isReady).toBe(false);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: 'purchase-total-mismatch',
        severity: 'blocking',
      })
    );
  });

  it('groups compatible repeated service rows into one stable customer identity', () => {
    const rows = [
      source(2, {
        legacyMemberId: 'M-1',
        original: {
          name: 'Asha',
          phone: '+15550000022',
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceStart: '01/01/2026',
          fee: '4000',
          amountPaid: '4000',
        },
      }),
      source(3, {
        legacyMemberId: 'M-1',
        original: {
          name: 'Asha',
          phone: '+15550000022',
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceStart: '01/03/2026',
          fee: '4000',
          amountPaid: '4000',
        },
      }),
    ];
    const first = build(rows);
    const second = build(rows);

    expect(first.every((candidate) => candidate.isReady)).toBe(true);
    expect(
      new Set(first.map((candidate) => candidate.customerGroupKey)).size
    ).toBe(1);
    expect(first[0].customerIdempotencyKey).toBe(
      first[1].customerIdempotencyKey
    );
    expect(first.map((candidate) => candidate.purchaseIdempotencyKey)).toEqual(
      second.map((candidate) => candidate.purchaseIdempotencyKey)
    );
    expect(first[0].purchaseIdempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('blocks incompatible shared identities and exact duplicate service purchases', () => {
    const conflicting = build([
      source(2, {
        legacyMemberId: 'M-1',
        original: { name: 'Asha', phone: '+15550000022' },
      }),
      source(3, {
        legacyMemberId: 'M-2',
        original: { name: 'Ravi', phone: '+15550000022' },
      }),
    ]);
    expect(
      conflicting.every((candidate) =>
        candidate.issues.some((item) => item.code === 'shared-phone')
      )
    ).toBe(true);

    const duplicate = build([
      source(4, {
        legacyMemberId: 'M-3',
        original: {
          name: 'Meera',
          phone: '+15550000044',
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceStart: '01/01/2026',
          fee: '4000',
          amountPaid: '4000',
        },
      }),
      source(5, {
        legacyMemberId: 'M-3',
        original: {
          name: 'Meera',
          phone: '+15550000044',
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          serviceStart: '01/01/2026',
          fee: '4000',
          amountPaid: '4000',
        },
      }),
    ]);
    expect(
      duplicate.every((candidate) =>
        candidate.issues.some((item) => item.code === 'duplicate-service')
      )
    ).toBe(true);
  });

  it('moves a saved candidate back to resolution when a service is archived', () => {
    const saved = build([
      source(2, {
        original: {
          planName: '',
          serviceName: 'Personal training',
          serviceOption: '1 month',
          fee: '4000',
          amountPaid: '4000',
        },
      }),
    ]);
    expect(saved[0].isReady).toBe(true);

    const [resumed] = revalidateMemberImportCandidates(saved, {
      plans: PLANS,
      catalogItems: SERVICES.map((item) => ({ ...item, is_active: false })),
      trainers: [],
      trainerRates: [],
      dateOrder: 'DMY',
      today: TODAY,
    });

    expect(resumed.isReady).toBe(false);
    expect(resumed.issues).toContainEqual(
      expect.objectContaining({ code: 'service-needs-resolution' })
    );
  });

  it('keeps every source row while automatically excluding older history and summary rows', () => {
    const candidates = build([
      source(2, {
        sourceKey: 'older',
        legacyMemberId: 'M-1',
        original: { startDate: '01/01/2025' },
      }),
      source(3, {
        sourceKey: 'latest-first-tie',
        legacyMemberId: 'M-1',
        original: { startDate: '01/01/2026' },
      }),
      source(4, {
        sourceKey: 'latest-wins-tie',
        legacyMemberId: 'M-1',
        original: { startDate: '01/01/2026' },
      }),
      source(5, {
        sourceKey: 'footer',
        legacyMemberId: null,
        isSummaryRow: true,
      }),
    ]);

    expect(candidates).toHaveLength(4);
    expect(
      candidates.find((candidate) => candidate.sourceKey === 'latest-wins-tie')
        ?.disposition
    ).toBe('included');
    expect(
      candidates.find((candidate) => candidate.sourceKey === 'older')
        ?.exclusionReason
    ).toBe('membership-history');
    expect(
      candidates.find((candidate) => candidate.sourceKey === 'latest-first-tie')
        ?.exclusionReason
    ).toBe('membership-history');
    expect(
      candidates.find((candidate) => candidate.sourceKey === 'footer')
        ?.exclusionReason
    ).toBe('summary-row');
  });

  it('preserves missing, invalid, and shared phones and recomputes collisions after a draft edit', () => {
    let candidates = build([
      source(2, { original: { phone: '' } }),
      source(3, { original: { phone: 'not-a-phone' } }),
      source(4, { original: { phone: '+15550000044' } }),
      source(5, { original: { phone: '+15550000044' } }),
    ]);

    expect(candidates).toHaveLength(4);
    expect(candidates[0].issues.map((issue) => issue.code)).toContain(
      'missing-phone'
    );
    expect(candidates[1].issues.map((issue) => issue.code)).toContain(
      'invalid-phone'
    );
    expect(
      candidates
        .slice(2)
        .every((candidate) =>
          candidate.issues.some((issue) => issue.code === 'shared-phone')
        )
    ).toBe(true);

    candidates = patchMemberImportCandidate(
      candidates,
      'sheet-1:5',
      {
        phone: '+15550000055',
      },
      { plans: PLANS, dateOrder: 'DMY', today: TODAY }
    );
    expect(
      candidates
        .slice(2)
        .every(
          (candidate) =>
            !candidate.issues.some((issue) => issue.code === 'shared-phone')
        )
    ).toBe(true);

    candidates = patchMemberImportCandidate(
      candidates,
      'sheet-1:4',
      {
        disposition: 'excluded',
      },
      { plans: PLANS, dateOrder: 'DMY', today: TODAY }
    );
    expect(
      candidates.find((candidate) => candidate.sourceKey === 'sheet-1:4')
        ?.disposition
    ).toBe('excluded');
    expect(
      candidates.find((candidate) => candidate.sourceKey === 'sheet-1:5')
        ?.isReady
    ).toBe(true);
  });

  it('carries grouped plan and pricing-option resolutions together', () => {
    let candidates = build([
      source(2, {
        original: { planName: 'Unknown plan', pricingOption: 'Monthly' },
      }),
      source(3, {
        original: { planName: 'Unknown plan', pricingOption: 'Monthly' },
      }),
    ]);
    candidates = resolveGroupedPlan(
      candidates,
      ['sheet-1:2', 'sheet-1:3'],
      {
        planId: 'plan-gold',
        pricingOptionId: 'gold-quarter',
      },
      { plans: PLANS, dateOrder: 'DMY', today: TODAY }
    );

    expect(candidates.map((candidate) => candidate.resolutions.plan)).toEqual([
      { planId: 'plan-gold', pricingOptionId: 'gold-quarter' },
      { planId: 'plan-gold', pricingOptionId: 'gold-quarter' },
    ]);
    expect(
      candidates.map(
        (candidate) => candidate.built.membership?.pricing_option_id
      )
    ).toEqual(['gold-quarter', 'gold-quarter']);
  });

  it('accepts FREEZED case-insensitively and treats an explicit expiry mismatch as a notice that wins in the payload', () => {
    const [candidate] = build([
      source(2, {
        original: {
          status: '  FREEZED ',
          startDate: '01/01/2026',
          endDate: '15/01/2026',
        },
      }),
    ]);

    expect(candidate.built.membership?.status).toBe('frozen');
    expect(candidate.built.membership?.end_date).toBe('2026-01-15');
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: 'expiry-duration-mismatch',
        severity: 'notice',
      })
    );
    expect(candidate.isReady).toBe(true);
  });

  it('requires a payment decision, supports manual correction, and can import the member without a payment', () => {
    let candidates = build([
      source(2, {
        original: { fee: '1200', amountPaid: '700', balance: '600' },
      }),
    ]);
    expect(candidates[0].isReady).toBe(false);
    expect(candidates[0].issues).toContainEqual(
      expect.objectContaining({
        code: 'payment-conflict',
        severity: 'decision',
      })
    );

    candidates = resolvePaymentConflict(
      candidates,
      'sheet-1:2',
      'manual',
      {
        paid: '700',
        balance: '500',
      },
      { plans: PLANS, dateOrder: 'DMY', today: TODAY }
    );
    expect(candidates[0].isReady).toBe(true);
    expect(candidates[0].built.payment?.amount).toBe(700);

    candidates = resolvePaymentConflict(
      candidates,
      'sheet-1:2',
      'member_only',
      undefined,
      {
        plans: PLANS,
        dateOrder: 'DMY',
        today: TODAY,
      }
    );
    expect(candidates[0].built.payment).toBeNull();
    expect(candidates[0].isReady).toBe(true);
  });

  it('requires a choice for an existing contact and automatically excludes an existing member', () => {
    let candidates = build([
      source(2, {
        existingMatch: {
          contactId: 'contact-1',
          isMember: false,
          profileConflict: true,
        },
      }),
      source(3, { existingMatch: { contactId: 'contact-2', isMember: true } }),
    ]);
    expect(candidates[0].issues).toContainEqual(
      expect.objectContaining({
        code: 'existing-contact',
        severity: 'decision',
      })
    );
    expect(candidates[1].exclusionReason).toBe('existing-member');

    candidates = resolveExistingContact(candidates, 'sheet-1:2', 'use_csv', {
      plans: PLANS,
      dateOrder: 'DMY',
      today: TODAY,
    });
    expect(candidates[0].isReady).toBe(true);
    expect(candidates[0].resolutions.existingContact).toBe('use_csv');
  });

  it('groups equivalent issues deterministically and only asks about actual existing-profile conflicts', () => {
    const candidates = build([
      source(2, { original: { phone: '+15550000044' } }),
      source(3, { original: { phone: '+15550000044' } }),
      source(4, {
        existingMatch: {
          contactId: 'safe-contact',
          isMember: false,
          profileConflict: false,
        },
      }),
      source(5, {
        existingMatch: {
          contactId: 'conflict-contact',
          isMember: false,
          profileConflict: true,
        },
      }),
    ]);
    const shared = candidates
      .slice(0, 2)
      .flatMap((candidate) =>
        candidate.issues.filter((item) => item.code === 'shared-phone')
      );

    expect(shared.map((item) => item.groupKey)).toEqual([
      'shared-phone:15550000044',
      'shared-phone:15550000044',
    ]);
    expect(shared[0]).toEqual(
      expect.objectContaining({
        explanation: expect.any(String),
        nextAction: expect.any(String),
      })
    );
    expect(
      candidates[2].issues.some((item) => item.code === 'existing-contact')
    ).toBe(false);
    expect(candidates[3].issues).toContainEqual(
      expect.objectContaining({
        code: 'existing-contact',
        groupKey: 'existing-contact:conflict-contact',
      })
    );
  });

  it('derives filters, searches, and all confirmation counts from the same candidates', () => {
    let candidates = build([
      source(2),
      source(3, { original: { phone: '' } }),
      source(4),
      source(5, {
        existingMatch: {
          contactId: 'contact-1',
          isMember: false,
          profileConflict: true,
        },
      }),
    ]);
    candidates = patchMemberImportCandidate(
      candidates,
      'sheet-1:4',
      { disposition: 'excluded' },
      {
        plans: PLANS,
        dateOrder: 'DMY',
        today: TODAY,
      }
    );
    const summary = summarizeMemberImportCandidates(candidates);

    expect(summary).toMatchObject({
      source: 4,
      included: 3,
      ready: 1,
      needsResolution: 2,
      exclusions: 1,
      automaticExcluded: 0,
      explicitlyExcluded: 1,
      newContacts: 2,
      attachedContacts: 1,
      memberships: 1,
      payments: 1,
      memberOnlyImports: 0,
    });
    expect(summary.exclusions).toBe(
      summary.automaticExcluded + summary.explicitlyExcluded
    );
    expect(filterMemberImportCandidates(candidates, 'all')).toHaveLength(
      summary.source
    );
    expect(filterMemberImportCandidates(candidates, 'ready')).toHaveLength(
      summary.ready
    );
    expect(
      filterMemberImportCandidates(candidates, 'needs-resolution')
    ).toHaveLength(summary.needsResolution);
    expect(filterMemberImportCandidates(candidates, 'excluded')).toHaveLength(
      summary.exclusions
    );
    expect(
      searchMemberImportCandidates(candidates, 'sample 2').map(
        (candidate) => candidate.sourceKey
      )
    ).toEqual(['sheet-1:2']);
  });

  it('uses the anonymized fixture without dropping its source rows', () => {
    const fixture = readFileSync(
      fileURLToPath(
        new URL('./__fixtures__/member-import-candidates.csv', import.meta.url)
      ),
      'utf8'
    )
      .trim()
      .split('\n')
      .slice(1)
      .map((line, index) => {
        const [
          legacyMemberId,
          name,
          phone,
          planName,
          startDate,
          endDate,
          status,
          fee,
          amountPaid,
          balance,
        ] = line.split(',');
        return source(index + 2, {
          sourceKey: `fixture:${index + 2}`,
          legacyMemberId: legacyMemberId || null,
          isSummaryRow: /^Number of records:/i.test(legacyMemberId),
          original: {
            name,
            phone,
            planName,
            startDate,
            endDate,
            status,
            fee,
            amountPaid,
            balance,
          },
        });
      });

    const candidates = build(fixture);
    expect(candidates).toHaveLength(6);
    expect(
      candidates.filter((candidate) => candidate.disposition === 'excluded')
    ).toHaveLength(2);
    expect(
      candidates.some((candidate) =>
        candidate.issues.some((issue) => issue.code === 'missing-phone')
      )
    ).toBe(true);
    expect(
      candidates.filter((candidate) =>
        candidate.issues.some((issue) => issue.code === 'shared-phone')
      )
    ).toHaveLength(2);
  });

  it('selects history deterministically across 5,000 source rows', () => {
    const rows = Array.from({ length: 5_000 }, (_, index) =>
      source(index + 2, {
        sourceKey: `bulk:${index + 2}`,
        legacyMemberId: `M-${index % 100}`,
        original: {
          startDate: `01/${String((index % 12) + 1).padStart(2, '0')}/2026`,
        },
      })
    );
    const candidates = build(rows);
    const included = candidates.filter(
      (candidate) => candidate.disposition === 'included'
    );

    expect(candidates).toHaveLength(5_000);
    expect(included).toHaveLength(100);
    expect(
      build(rows)
        .filter((candidate) => candidate.disposition === 'included')
        .map((candidate) => candidate.sourceKey)
    ).toEqual(included.map((candidate) => candidate.sourceKey));
  });
});
