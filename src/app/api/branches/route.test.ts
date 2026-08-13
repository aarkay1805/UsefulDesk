import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount };
});

import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { GET, POST } from './route';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';

const branch = {
  account_id: ACCOUNT_ID,
  account_name: 'Central',
  is_organization_owner: true,
  setup_reviewed_at: '2026-08-13T10:00:00.000Z',
  setup_reviewed_by: 'user-1',
};

function makeSupabase(options?: {
  owner?: boolean;
  createResult?: unknown;
  createError?: { code: string; message: string };
}) {
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    if (name === 'my_branch_accounts') {
      return {
        data: [{ ...branch, is_organization_owner: options?.owner ?? true }],
        error: null,
      };
    }
    return {
      data: options?.createResult ?? null,
      error: options?.createError ?? null,
      args,
    };
  });
  const from = vi.fn(() => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      order: vi.fn(async () => ({
        data: [
          {
            id: ENTITY_ID,
            name: 'Useful Fitness Pvt Ltd',
            default_currency: 'INR',
          },
        ],
        error: null,
      })),
    };
    return builder;
  });
  return { rpc, from };
}

function setContext(supabase: ReturnType<typeof makeSupabase>) {
  getCurrentAccount.mockResolvedValue({
    supabase,
    userId: 'user-1',
    accountId: ACCOUNT_ID,
    role: 'owner',
    account: { organizationId: 'organization-1' },
  });
}

function post(body: unknown, origin = true) {
  return POST(
    new Request('https://desk.example/api/branches', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin
          ? { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }
          : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

describe('/api/branches contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
  });

  it('returns review markers and active legal entities to organization owners', async () => {
    const supabase = makeSupabase();
    setContext(supabase);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.branches[0]).toMatchObject({
      setup_reviewed_at: branch.setup_reviewed_at,
      setup_reviewed_by: branch.setup_reviewed_by,
    });
    expect(body.legalEntities).toEqual([
      {
        id: ENTITY_ID,
        name: 'Useful Fitness Pvt Ltd',
        defaultCurrency: 'INR',
      },
    ]);
  });

  it('returns no legal entities to non-organization owners', async () => {
    const supabase = makeSupabase({ owner: false });
    setContext(supabase);

    const body = await (await GET()).json();

    expect(body.legalEntities).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('preserves legacy blank creation for same-origin browser calls', async () => {
    const supabase = makeSupabase({ createResult: SOURCE_ID });
    setContext(supabase);

    const response = await post({ name: 'North', legalEntityId: ENTITY_ID });

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith('create_organization_branch', {
      p_organization_id: 'organization-1',
      p_legal_entity_id: ENTITY_ID,
      p_name: 'North',
    });
  });

  it('normalizes new copy requests and returns 200 for an idempotent replay', async () => {
    const result = {
      accountId: ACCOUNT_ID,
      readinessState: 'setup',
      replayed: true,
      setupReviewedAt: null,
      copied: { totalRows: 0, breakdown: {} },
      systemSeeded: { expenseCategories: 5 },
      warnings: [],
      credentialsCloned: false,
    };
    const supabase = makeSupabase({ createResult: result });
    setContext(supabase);

    const response = await post({
      requestId: REQUEST_ID,
      name: 'North',
      legalEntityId: ENTITY_ID,
      startMode: 'copy',
      sourceAccountId: SOURCE_ID,
      packs: ['flows'],
    });

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_organization_branch_from_setup',
      expect.objectContaining({ p_packs: ['lead_setup', 'flows'] })
    );
  });

  it('maps idempotency conflicts and hides unexpected SQL errors', async () => {
    const conflict = makeSupabase({
      createError: { code: '23505', message: 'Request ID conflict' },
    });
    setContext(conflict);
    const request = {
      requestId: REQUEST_ID,
      name: 'North',
      legalEntityId: ENTITY_ID,
      startMode: 'blank',
      packs: [],
    };
    expect((await post(request)).status).toBe(409);

    const unexpected = makeSupabase({
      createError: { code: 'XX000', message: 'raw SQL internals' },
    });
    setContext(unexpected);
    const response = await post(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to create branch' });
  });

  it('rejects originless creation before resolving the account', async () => {
    const response = await post(
      { name: 'North', legalEntityId: ENTITY_ID },
      false
    );

    expect(response.status).toBe(403);
    expect(getCurrentAccount).not.toHaveBeenCalled();
  });
});
