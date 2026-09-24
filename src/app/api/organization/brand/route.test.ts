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

const accountId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

function request(body: unknown, sameOrigin = true) {
  return new Request('https://desk.example/api/organization/brand', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(sameOrigin
        ? { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

function setContext(owner = true) {
  const rpc = vi.fn(async (name: string) =>
    name === 'my_branch_accounts'
      ? {
          data: [
            {
              account_id: accountId,
              organization_id: organizationId,
              is_organization_owner: owner,
            },
          ],
          error: null,
        }
      : { data: 'Iron House', error: null }
  );
  getCurrentAccount.mockResolvedValue({
    userId: 'user-1',
    accountId,
    account: { organizationId },
    supabase: { rpc },
  });
  return rpc;
}

describe('/api/organization/brand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
  });

  it('saves a trimmed brand for an organization owner', async () => {
    const rpc = setContext();
    const response = await PATCH(request({ name: '  Iron House  ' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Iron House' });
    expect(rpc).toHaveBeenCalledWith('save_organization_brand_name', {
      p_account_id: accountId,
      p_brand_name: 'Iron House',
    });
  });

  it('blocks non-owners before calling the save RPC', async () => {
    const rpc = setContext(false);
    const response = await PATCH(request({ name: 'Iron House' }));

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalledWith(
      'save_organization_brand_name',
      expect.anything()
    );
  });

  it('rejects invalid input', async () => {
    const rpc = setContext();
    const response = await PATCH(request({ name: '   ' }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalledWith(
      'save_organization_brand_name',
      expect.anything()
    );
  });

  it('rejects originless writes before resolving the account', async () => {
    const response = await PATCH(request({ name: 'Iron House' }, false));

    expect(response.status).toBe(403);
    expect(getCurrentAccount).not.toHaveBeenCalled();
  });
});
