import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  readRecoveryIntent,
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
const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
  auth.exchangeCodeForSession.mockReset();
  auth.verifyOtp.mockReset();
});

describe('auth callback recovery handoff', () => {
  it('keeps an invitation continuation when an ordinary code exchange fails', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: 'PKCE verifier missing' },
    });

    const response = await GET(
      new NextRequest(
        `https://desk.example/auth/callback?code=code-1&next=${encodeURIComponent(`/join/${INVITE_TOKEN}`)}`
      )
    );
    const location = new URL(response.headers.get('location')!);

    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toContain(
      'Could not complete sign-in'
    );
    expect(location.searchParams.get('invite')).toBe(INVITE_TOKEN);
  });

  it('keeps an invitation continuation when token-hash verification fails', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: {},
      error: { message: 'Token expired' },
    });

    const response = await GET(
      new NextRequest(
        `https://desk.example/auth/callback?token_hash=hash-1&type=signup&next=${encodeURIComponent(`/join/${INVITE_TOKEN}`)}`
      )
    );
    const location = new URL(response.headers.get('location')!);

    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('invite')).toBe(INVITE_TOKEN);
  });

  it('keeps an invitation continuation from provider-reported link errors', async () => {
    const response = await GET(
      new NextRequest(
        `https://desk.example/auth/callback?error=access_denied&error_description=Link%20expired&next=${encodeURIComponent(`/join/${INVITE_TOKEN}`)}`
      )
    );
    const location = new URL(response.headers.get('location')!);

    expect(location.searchParams.get('error')).toBe('Link expired');
    expect(location.searchParams.get('invite')).toBe(INVITE_TOKEN);
  });

  it('never converts an arbitrary next value into a login continuation', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: 'bad code' },
    });

    const response = await GET(
      new NextRequest(
        'https://desk.example/auth/callback?code=code-1&next=%2F%2Fevil.example'
      )
    );
    const location = new URL(response.headers.get('location')!);

    expect(location.origin).toBe('https://desk.example');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('invite')).toBeNull();
  });

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

  it('signs the Add password return to Login & security', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { redirectType: 'recovery', user: { id: USER_ID } },
      error: null,
    });

    const response = await GET(
      new NextRequest(
        'https://desk.example/auth/callback?code=code-1&next=%2Fsettings%3Ftab%3Dsecurity'
      )
    );

    expect(
      readRecoveryIntent(
        response.cookies.get(RECOVERY_INTENT_COOKIE)?.value,
        USER_ID,
        SECRET
      )
    ).toEqual({ continueTo: '/settings?tab=security' });
  });

  it('carries an invitation into an authorized recovery landing page', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { redirectType: 'recovery', user: { id: USER_ID } },
      error: null,
    });

    const response = await GET(
      new NextRequest(
        `https://desk.example/auth/callback?code=code-1&next=${encodeURIComponent(`/join/${INVITE_TOKEN}`)}`
      )
    );

    expect(response.headers.get('location')).toBe(
      `https://desk.example/reset-password?invite=${INVITE_TOKEN}`
    );
    expect(
      readRecoveryIntent(
        response.cookies.get(RECOVERY_INTENT_COOKIE)?.value,
        USER_ID,
        SECRET
      )
    ).toEqual({ continueTo: `/join/${INVITE_TOKEN}` });
  });
});
