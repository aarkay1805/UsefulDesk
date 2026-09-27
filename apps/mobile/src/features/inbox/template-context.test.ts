import {
  loadTemplateContext,
  parseTemplateMembership,
  type TemplateContextSource,
} from './template-context';

jest.mock('../../data/supabase', () => ({
  mobileSupabase: {},
  selectedBranchRef: { get: () => null },
}));

const ACCOUNT_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const CONTACT_ID = '1b1f7d0e-7fd4-4a5d-9a0f-0c5b0d3c9f11';

function source(
  overrides: Partial<TemplateContextSource> = {}
): TemplateContextSource {
  return {
    loadLegalName: jest
      .fn()
      .mockResolvedValue({ ok: true, name: 'Iron House Fitness' }),
    loadMembership: jest.fn().mockResolvedValue({
      end_date: '2026-09-30',
      fee_amount: '4500.00',
      plan: { name: 'Gold 3 months' },
    }),
    ...overrides,
  };
}

describe('parseTemplateMembership', () => {
  it('reads the plan from either relationship shape and a numeric fee', () => {
    expect(
      parseTemplateMembership({
        end_date: '2026-09-30',
        fee_amount: 4500,
        plan: [{ name: ' Gold ' }],
      })
    ).toEqual({ planName: 'Gold', endDate: '2026-09-30', feeAmount: 4500 });
  });

  it('returns no membership for a member without one', () => {
    expect(parseTemplateMembership(null)).toBeNull();
  });

  it('drops a fee it cannot read instead of showing a wrong amount', () => {
    expect(
      parseTemplateMembership({ end_date: null, fee_amount: 'abc', plan: null })
    ).toEqual({ planName: null, endDate: null, feeAmount: null });
  });
});

describe('loadTemplateContext', () => {
  it('loads the legal name and membership for this branch and member', async () => {
    const templateSource = source();

    await expect(
      loadTemplateContext(templateSource, ACCOUNT_ID, CONTACT_ID)
    ).resolves.toEqual({
      legalName: { status: 'ready', name: 'Iron House Fitness' },
      membership: {
        status: 'ready',
        membership: {
          planName: 'Gold 3 months',
          endDate: '2026-09-30',
          feeAmount: 4500,
        },
      },
    });
    expect(templateSource.loadLegalName).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(templateSource.loadMembership).toHaveBeenCalledWith(
      ACCOUNT_ID,
      CONTACT_ID
    );
  });

  it('tells a missing legal name apart from a lookup that failed', async () => {
    await expect(
      loadTemplateContext(
        source({
          loadLegalName: jest.fn().mockResolvedValue({
            ok: false,
            code: 'legal_business_identity_missing',
          }),
        }),
        ACCOUNT_ID,
        CONTACT_ID
      )
    ).resolves.toMatchObject({ legalName: { status: 'missing' } });

    await expect(
      loadTemplateContext(
        source({
          loadLegalName: jest.fn().mockResolvedValue({
            ok: false,
            code: 'legal_business_identity_lookup_unavailable',
          }),
        }),
        ACCOUNT_ID,
        CONTACT_ID
      )
    ).resolves.toMatchObject({ legalName: { status: 'unavailable' } });
  });

  it('lets each half fail on its own, including a synchronous throw', async () => {
    await expect(
      loadTemplateContext(
        source({
          loadLegalName: jest.fn(() => {
            throw new Error('wrong branch');
          }),
          loadMembership: jest.fn().mockRejectedValue(new Error('network')),
        }),
        ACCOUNT_ID,
        CONTACT_ID
      )
    ).resolves.toEqual({
      legalName: { status: 'unavailable' },
      membership: { status: 'unavailable' },
    });
  });

  it('stops waiting for a read that never answers', async () => {
    jest.useFakeTimers();
    try {
      const pending = loadTemplateContext(
        source({ loadMembership: jest.fn(() => new Promise(() => {})) }),
        ACCOUNT_ID,
        CONTACT_ID,
        1000
      );
      await jest.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toMatchObject({
        legalName: { status: 'ready' },
        membership: { status: 'unavailable' },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
