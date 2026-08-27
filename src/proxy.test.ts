import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DASHBOARD_PATH_PREFIXES } from '@/lib/auth/dashboard-routes';

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — whether getClaims() resolves a securely signed subject,
//                      or null for the logged-out path.
// `refreshedCookies` — cookies Supabase writes via setAll() during getClaims(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    }
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed while getClaims() loads the session, which rotates the token and
      // pushes the new cookies through setAll() before resolving.
      getClaims: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return {
          data: { claims: mockUser ? { sub: mockUser.id } : null },
        };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { proxy } = await import('./proxy');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: 'sb-test-auth-token',
  value: 'rotated-refresh-token',
  options: { path: '/', httpOnly: true },
};
const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

describe('proxy authentication', () => {
  it('carries the rotated token when redirecting a signed-in user off /login', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(new NextRequest('https://app.test/login'));

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('carries the rotated token when redirecting an unauth user to /login', async () => {
    mockUser = null;
    // Even on the logged-out path getClaims() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: 'cleared' }];

    const res = await proxy(new NextRequest('https://app.test/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get(ROTATED.name)?.value).toBe('cleared');
  });

  it('redirects a signed-in user with an invite token to /join/<token>', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(
      new NextRequest(`https://app.test/login?invite=${INVITE_TOKEN}`)
    );

    expect(res.headers.get('location')).toContain(`/join/${INVITE_TOKEN}`);
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('keeps a signed-in invitee on the join flow from forgot-password', async () => {
    mockUser = { id: 'user-1' };

    const res = await proxy(
      new NextRequest(`https://app.test/forgot-password?invite=${INVITE_TOKEN}`)
    );

    expect(res.headers.get('location')).toBe(
      `https://app.test/join/${INVITE_TOKEN}`
    );
  });

  it('does not treat an untrusted invite query as a continuation', async () => {
    mockUser = { id: 'user-1' };

    const res = await proxy(
      new NextRequest('https://app.test/login?invite=%2F%2Fevil.example')
    );

    expect(res.headers.get('location')).toBe('https://app.test/dashboard');
  });

  it('passes through (no redirect) for a signed-in user on a protected page', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(new NextRequest('https://app.test/dashboard'));

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('forwards only the URL-derived dashboard branch upstream', async () => {
    mockUser = { id: 'user-1' };
    const branch = '00000000-0000-4000-8000-000000000001';

    const res = await proxy(
      new NextRequest(`https://app.test/dashboard?branch=${branch}`, {
        headers: { 'x-usefuldesk-account-id': 'forged' },
      })
    );

    expect(
      res.headers.get('x-middleware-request-x-usefuldesk-account-id')
    ).toBe(branch);
  });

  it('removes a caller-authored tenant header from non-dashboard requests', async () => {
    mockUser = { id: 'user-1' };

    const res = await proxy(
      new NextRequest('https://app.test/api/onboarding/status', {
        headers: { 'x-usefuldesk-account-id': 'forged' },
      })
    );

    expect(
      res.headers.get('x-middleware-request-x-usefuldesk-account-id')
    ).toBeNull();
  });

  it.each(DASHBOARD_PATH_PREFIXES)(
    'redirects an anonymous request for %s to login',
    async (pathname) => {
      const res = await proxy(new NextRequest(`https://app.test${pathname}`));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://app.test/login');
    }
  );

  it.each(DASHBOARD_PATH_PREFIXES)(
    'allows an authenticated request for %s',
    async (pathname) => {
      mockUser = { id: 'user-1' };

      const res = await proxy(new NextRequest(`https://app.test${pathname}`));

      expect(res.headers.get('location')).toBeNull();
    }
  );

  it.each([
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/join/invite-token',
    '/f/form-token',
    '/data-deletion',
    '/auth/callback',
  ])('preserves anonymous access to %s', async (pathname) => {
    const res = await proxy(new NextRequest(`https://app.test${pathname}`));

    expect(res.headers.get('location')).toBeNull();
  });
});
