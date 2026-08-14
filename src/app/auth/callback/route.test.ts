import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  RECOVERY_INTENT_COOKIE,
  verifyRecoveryIntent,
} from '@/lib/auth/recovery-intent';

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth })),
}));

const { GET } = await import('./route');

const SECRET = 'test-service-role-signing-secret';
const USER_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
  auth.exchangeCodeForSession.mockReset();
  auth.verifyOtp.mockReset();
});

describe('auth callback recovery handoff', () => {
  it('mints a signed recovery grant only for a recovery PKCE exchange', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { redirectType: 'recovery', user: { id: USER_ID } },
      error: null,
    });

    const response = await GET(
      new NextRequest(
        'https://desk.example/auth/callback?code=code-1&next=/dashboard'
      )
    );
    const token = response.cookies.get(RECOVERY_INTENT_COOKIE)?.value;

    expect(response.headers.get('location')).toBe(
      'https://desk.example/reset-password'
    );
    expect(verifyRecoveryIntent(token, USER_ID, SECRET)).toBe(true);
  });

  it('does not mint recovery access for an ordinary auth code', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { redirectType: null, user: { id: USER_ID } },
      error: null,
    });

    const response = await GET(
      new NextRequest(
        'https://desk.example/auth/callback?code=code-1&next=/dashboard'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://desk.example/dashboard'
    );
    expect(response.cookies.get(RECOVERY_INTENT_COOKIE)).toBeUndefined();
  });

  it('supports a verified token-hash recovery link', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });

    const response = await GET(
      new NextRequest(
        'https://desk.example/auth/callback?token_hash=hash-1&type=recovery&next=/reset-password'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://desk.example/reset-password'
    );
    expect(
      verifyRecoveryIntent(
        response.cookies.get(RECOVERY_INTENT_COOKIE)?.value,
        USER_ID,
        SECRET
      )
    ).toBe(true);
  });
});
