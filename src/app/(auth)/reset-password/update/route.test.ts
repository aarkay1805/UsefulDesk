import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  issueRecoveryIntent,
  RECOVERY_INTENT_COOKIE,
} from '@/lib/auth/recovery-intent';

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth })),
}));

const { GET, POST } = await import('./route');

const SECRET = 'test-service-role-signing-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function request(
  method: 'GET' | 'POST',
  token?: string,
  body?: Record<string, unknown>
) {
  const headers = new Headers();
  if (token) headers.set('cookie', `${RECOVERY_INTENT_COOKIE}=${token}`);
  if (method === 'POST') {
    headers.set('origin', 'https://desk.example');
    headers.set('sec-fetch-site', 'same-origin');
    headers.set('content-type', 'application/json');
  }
  return new NextRequest('https://desk.example/reset-password/update', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
  auth.getUser.mockReset().mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  auth.updateUser.mockReset().mockResolvedValue({ error: null });
});

describe('password recovery update route', () => {
  it('rejects an ordinary authenticated session without recovery intent', async () => {
    const response = await POST(
      request('POST', undefined, { password: 'new-password' })
    );

    expect(response.status).toBe(403);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('exposes the form only for the authenticated recovery user', async () => {
    const token = issueRecoveryIntent(USER_ID, SECRET);

    await expect((await GET(request('GET', token))).json()).resolves.toEqual({
      allowed: true,
    });
    await expect((await GET(request('GET'))).json()).resolves.toEqual({
      allowed: false,
    });
    await expect(
      (
        await GET(request('GET', issueRecoveryIntent('another-user', SECRET)))
      ).json()
    ).resolves.toEqual({ allowed: false });
  });

  it('updates the password through a valid grant and clears that grant', async () => {
    const token = issueRecoveryIntent(USER_ID, SECRET);
    const response = await POST(
      request('POST', token, { password: 'new-password' })
    );

    expect(response.status).toBe(200);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
    expect(response.headers.get('set-cookie')).toContain(
      `${RECOVERY_INTENT_COOKIE}=`
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('enforces same-origin submission and the eight-character policy', async () => {
    const token = issueRecoveryIntent(USER_ID, SECRET);
    const crossSite = request('POST', token, { password: 'new-password' });
    crossSite.headers.set('origin', 'https://evil.example');

    expect((await POST(crossSite)).status).toBe(403);
    expect(
      (await POST(request('POST', token, { password: 'short' }))).status
    ).toBe(400);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
