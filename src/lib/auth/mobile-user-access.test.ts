import { describe, expect, it, vi } from 'vitest';

import { createMobileUserAccess } from './mobile-user-access';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function setup(input?: { user?: { id: string } | null; error?: unknown }) {
  const auth = {
    getUser: vi.fn(async () => ({
      data: { user: input?.user === undefined ? { id: USER_ID } : input.user },
      error: input?.error ?? null,
    })),
  };
  const createSupabaseClient = vi.fn(() => ({ auth }));
  const access = createMobileUserAccess({
    createSupabaseClient: createSupabaseClient as never,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
  });
  return { access, auth, createSupabaseClient };
}

function request(authorization?: string, branch?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  if (branch !== undefined) headers.set('x-usefuldesk-account-id', branch);
  return new Request('https://desk.example/api/mobile/push/installation', {
    headers,
  });
}

describe('branch-independent mobile user access', () => {
  it.each([
    ['missing', undefined],
    ['lowercase scheme', 'bearer token'],
    ['bare token', 'token'],
    ['extra whitespace', 'Bearer  token'],
  ])(
    'rejects %s authorization before Supabase access',
    async (_name, value) => {
      const { access, auth, createSupabaseClient } = setup();

      await expect(
        access.requireMobileUser(request(value))
      ).rejects.toMatchObject({ status: 401 });
      expect(auth.getUser).not.toHaveBeenCalled();
      expect(createSupabaseClient).not.toHaveBeenCalled();
    }
  );

  it('rejects expired or otherwise invalid Supabase access tokens', async () => {
    const { access, auth } = setup({
      user: null,
      error: { message: 'JWT expired' },
    });

    await expect(
      access.requireMobileUser(request('Bearer expired-token'))
    ).rejects.toMatchObject({ status: 401 });
    expect(auth.getUser).toHaveBeenCalledWith('expired-token');
  });

  it('returns server-confirmed identity without requiring or reading a branch', async () => {
    const { access, auth, createSupabaseClient } = setup();

    await expect(
      access.requireMobileUser(
        request('Bearer access-token', '22222222-2222-4222-8222-222222222222')
      )
    ).resolves.toEqual({ userId: USER_ID, accessToken: 'access-token' });
    expect(auth.getUser).toHaveBeenCalledWith('access-token');
    expect(createSupabaseClient).toHaveBeenCalledOnce();
  });
});
