import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  getCurrentAccount: h.getCurrentAccount,
}));

import { GYM_NAME_ERROR } from '@/lib/auth/gym-name';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { POST } from './route';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function request(
  body: unknown,
  options: { branch?: string; origin?: boolean; rawBody?: string } = {}
) {
  const url = new URL('https://desk.example/api/auth/complete-signup');
  if (options.branch !== undefined) {
    url.searchParams.set('branch', options.branch);
  }
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.origin === false
        ? {}
        : { origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' }),
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
}

describe('POST /api/auth/complete-signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
    h.rpc.mockResolvedValue({ data: { status: 'completed' }, error: null });
    h.getCurrentAccount.mockResolvedValue({
      supabase: { rpc: h.rpc },
      accountId: ACCOUNT_ID,
      userId: 'user-1',
      role: 'owner',
    });
  });

  it('completes the explicitly selected branch through the session client', async () => {
    const response = await POST(
      request({ gymName: '  Useful Fitness  ' }, { branch: ACCOUNT_ID })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'completed' });
    expect(h.getCurrentAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(h.rpc).toHaveBeenCalledWith('complete_organization_name_setup', {
      p_account_id: ACCOUNT_ID,
      p_gym_name: 'Useful Fitness',
    });
  });

  it('accepts an already-complete result for staff without an endpoint role gate', async () => {
    h.getCurrentAccount.mockResolvedValue({
      supabase: { rpc: h.rpc },
      accountId: ACCOUNT_ID,
      userId: 'user-2',
      role: 'viewer',
    });
    h.rpc.mockResolvedValue({
      data: { status: 'already_complete' },
      error: null,
    });

    const response = await POST(
      request({ gymName: 'Ignored retry value' }, { branch: ACCOUNT_ID })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'already_complete' });
  });

  it.each([undefined, '', 'not-a-branch'])(
    'rejects a missing or malformed explicit branch (%s)',
    async (branch) => {
      const response = await POST(request({ gymName: 'Useful' }, { branch }));

      expect(response.status).toBe(400);
      expect(h.getCurrentAccount).not.toHaveBeenCalled();
    }
  );

  it('rejects originless requests before resolving account access', async () => {
    const response = await POST(
      request({ gymName: 'Useful' }, { branch: ACCOUNT_ID, origin: false })
    );

    expect(response.status).toBe(403);
    expect(h.getCurrentAccount).not.toHaveBeenCalled();
  });

  it.each([
    [{ gymName: '' }, GYM_NAME_ERROR],
    [{ gymName: 'Useful', extra: true }, GYM_NAME_ERROR],
    [{ gymName: 42 }, GYM_NAME_ERROR],
    [null, GYM_NAME_ERROR],
  ])('enforces the exact validated request body %#', async (body, message) => {
    const response = await POST(request(body, { branch: ACCOUNT_ID }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['42501', 403],
    ['22023', 400],
    ['23505', 409],
  ])('maps RPC SQLSTATE %s to HTTP %i', async (code, status) => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code, message: 'database detail' },
    });

    const response = await POST(
      request({ gymName: 'Useful' }, { branch: ACCOUNT_ID })
    );

    expect(response.status).toBe(status);
  });

  it('sanitizes unexpected database errors without logging the gym name', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const gymName = 'Private Gym Name';
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: `failed for ${gymName}` },
    });

    const response = await POST(request({ gymName }, { branch: ACCOUNT_ID }));
    const logText = JSON.stringify(consoleError.mock.calls);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not complete gym setup. Please try again.',
    });
    expect(logText).not.toContain(gymName);
  });
});
