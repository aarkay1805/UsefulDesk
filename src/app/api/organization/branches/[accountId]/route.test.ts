import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount };
});

import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { PATCH } from './route';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

function setBranchOwnerContext(renameResult = 'South') {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'my_branch_accounts') {
      return {
        data: [
          {
            account_id: ACCOUNT_ID,
            account_name: 'Central',
            organization_id: ORGANIZATION_ID,
            organization_name: 'Useful Fitness',
            role: 'owner',
            branch_status: 'active',
            is_organization_owner: false,
          },
        ],
        error: null,
      };
    }
    if (name === 'rename_branch') {
      return { data: renameResult, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  getCurrentAccount.mockResolvedValue({
    supabase: { rpc },
    userId: 'user-1',
    accountId: '33333333-3333-4333-8333-333333333333',
    account: { organizationId: ORGANIZATION_ID },
  });
}

function patch(body: unknown, origin = 'https://desk.example') {
  return PATCH(
    new Request(
      `https://desk.example/api/organization/branches/${ACCOUNT_ID}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin,
          'sec-fetch-site':
            origin === 'https://desk.example' ? 'same-origin' : 'cross-site',
        },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ accountId: ACCOUNT_ID }) }
  );
}

describe('PATCH /api/organization/branches/[accountId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
  });

  it('lets the target branch owner rename without organization ownership', async () => {
    setBranchOwnerContext();

    const response = await patch({ action: 'rename', name: '  South  ' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      action: 'rename',
      name: 'South',
    });
  });

  it('rejects a cross-site rename before loading the caller', async () => {
    const response = await patch(
      { action: 'rename', name: 'South' },
      'https://evil.example'
    );

    expect(response.status).toBe(403);
    expect(getCurrentAccount).not.toHaveBeenCalled();
  });

  it('rejects an empty branch name after trimming', async () => {
    setBranchOwnerContext('');

    const response = await patch({ action: 'rename', name: '   ' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Branch name must be 1 to 80 characters',
    });
  });

  it('rejects a branch name longer than 80 characters', async () => {
    setBranchOwnerContext();

    const response = await patch({ action: 'rename', name: 'B'.repeat(81) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Branch name must be 1 to 80 characters',
    });
  });

  it('accepts 80 Unicode characters even when they use surrogate pairs', async () => {
    const name = '😀'.repeat(80);
    setBranchOwnerContext(name);

    const response = await patch({ action: 'rename', name });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name });
  });
});
