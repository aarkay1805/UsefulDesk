import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount };
});

import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { POST } from './route';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function request(body: unknown, origin = true) {
  return new Request(
    `https://desk.example/api/organization/branches/${ACCOUNT_ID}/complete-setup`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin
          ? { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }
          : {}),
      },
      body: JSON.stringify(body),
    }
  );
}

function complete(accountId = ACCOUNT_ID) {
  return POST(request({ configurationReviewed: true }), {
    params: Promise.resolve({ accountId }),
  });
}

describe('POST branch complete-setup', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
    rpc.mockResolvedValue({
      data: {
        accountId: ACCOUNT_ID,
        readinessState: 'ready',
        setupReviewedAt: '2026-08-13T10:00:00.000Z',
        setupReviewedBy: 'user-1',
        alreadyComplete: false,
      },
      error: null,
    });
    getCurrentAccount.mockResolvedValue({
      supabase: { rpc },
      accountId: ACCOUNT_ID,
      userId: 'user-1',
      role: 'admin',
    });
  });

  it('completes only the selected branch for an admin', async () => {
    const response = await complete();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('complete_organization_branch_setup', {
      p_account_id: ACCOUNT_ID,
      p_configuration_reviewed: true,
    });
  });

  it('rejects a path that is not the selected branch context', async () => {
    const response = await complete(OTHER_ID);

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects agents and exact-body violations', async () => {
    getCurrentAccount.mockResolvedValue({
      supabase: { rpc },
      accountId: ACCOUNT_ID,
      userId: 'user-1',
      role: 'agent',
    });
    expect((await complete()).status).toBe(403);

    getCurrentAccount.mockResolvedValue({
      supabase: { rpc },
      accountId: ACCOUNT_ID,
      userId: 'user-1',
      role: 'owner',
    });
    const response = await POST(
      request({ configurationReviewed: true, readinessState: 'ready' }),
      { params: Promise.resolve({ accountId: ACCOUNT_ID }) }
    );
    expect(response.status).toBe(400);
  });

  it('rejects originless completion before account resolution', async () => {
    const response = await POST(
      request({ configurationReviewed: true }, false),
      { params: Promise.resolve({ accountId: ACCOUNT_ID }) }
    );

    expect(response.status).toBe(403);
    expect(getCurrentAccount).not.toHaveBeenCalled();
  });
});
