import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { MembershipPlan } from '@/types';
import {
  buildMemberImportCandidates,
  filterMemberImportCandidates,
  patchMemberImportCandidate,
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

function build(rows: MemberImportCandidateInput[]) {
  return buildMemberImportCandidates(rows, {
    plans: PLANS,
    dateOrder: 'DMY',
    today: TODAY,
  });
}

describe('member import candidates', () => {
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
