import { describe, expect, it } from 'vitest';

import type { RazorpayOAuthConfig } from './razorpay-config';
import {
  buildRazorpayAuthorizationUrl,
  createRazorpayOAuthAttempt,
  parseRazorpayOAuthTokenResponse,
  validateConsumedOAuthState,
  verifyRazorpayOAuthReadiness,
  type RazorpayOAuthStateRow,
} from './razorpay-oauth';

const config: RazorpayOAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  clientIdFingerprint: 'fingerprint',
  mode: 'test',
  redirectUri: 'https://example.com/api/payments/razorpay/oauth/callback',
};

describe('Razorpay OAuth state and callback validation', () => {
  it('stores only a hash of high-entropy state and an encrypted PKCE verifier', () => {
    const attempt = createRazorpayOAuthAttempt({
      accountId: 'account',
      initiatedBy: 'user',
      config,
      now: new Date('2026-08-09T00:00:00Z'),
      random: (size) => Buffer.alloc(size, size),
    });
    expect(attempt.state.length).toBeGreaterThanOrEqual(43);
    expect(attempt.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(attempt.row.state_hash).not.toBe(attempt.state);
    expect(JSON.stringify(attempt.row)).not.toContain(attempt.state);
    expect(attempt.row.pkce_code_verifier).not.toContain(attempt.codeVerifier);
    expect(attempt.row.expires_at).toBe('2026-08-09T00:10:00.000Z');

    const authorize = new URL(
      buildRazorpayAuthorizationUrl({
        config,
        state: attempt.state,
        codeChallenge: attempt.codeChallenge,
      })
    );
    expect(authorize.searchParams.get('state')).toBe(attempt.state);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).not.toBe(
      attempt.codeVerifier
    );
  });

  const validRow: RazorpayOAuthStateRow = {
    id: 'state-id',
    account_id: 'account',
    initiated_by: 'user',
    client_id_fingerprint: config.clientIdFingerprint,
    mode: 'test',
    redirect_uri: config.redirectUri,
    pkce_code_verifier: 'encrypted',
    expires_at: '2026-08-09T00:10:00.000Z',
    consumed_at: '2026-08-09T00:01:00.000Z',
  };

  it('accepts only the exact consumed callback binding', () => {
    expect(() =>
      validateConsumedOAuthState(validRow, {
        accountId: 'account',
        initiatedBy: 'user',
        config,
        now: new Date('2026-08-09T00:02:00Z'),
      })
    ).not.toThrow();
  });

  it.each([
    ['wrong account', { account_id: 'other' }],
    ['wrong user', { initiated_by: 'other' }],
    ['wrong client', { client_id_fingerprint: 'other' }],
    ['wrong mode', { mode: 'live' }],
    ['wrong redirect', { redirect_uri: 'https://evil.example/callback' }],
    ['replay/unconsumed', { consumed_at: null }],
  ])('rejects %s', (_label, patch) => {
    expect(() =>
      validateConsumedOAuthState(
        { ...validRow, ...patch } as RazorpayOAuthStateRow,
        {
          accountId: 'account',
          initiatedBy: 'user',
          config,
          now: new Date('2026-08-09T00:02:00Z'),
        }
      )
    ).toThrow(/state binding/);
  });

  it('rejects an expired state', () => {
    expect(() =>
      validateConsumedOAuthState(validRow, {
        accountId: 'account',
        initiatedBy: 'user',
        config,
        now: new Date('2026-08-09T00:10:00Z'),
      })
    ).toThrow(/state binding/);
  });
});

describe('Razorpay OAuth token response', () => {
  const response = {
    token_type: 'Bearer',
    expires_in: 3600,
    access_token: 'access',
    refresh_token: 'refresh',
    razorpay_account_id: 'acc_123',
    scope: 'read_write',
    mode: 'test',
  };

  it('derives access and refresh rotation deadlines', () => {
    const tokens = parseRazorpayOAuthTokenResponse(
      response,
      'test',
      new Date('2026-08-09T00:00:00Z')
    );
    expect(tokens.accessExpiresAt.toISOString()).toBe(
      '2026-08-09T01:00:00.000Z'
    );
    expect(tokens.refreshExpiresAt.toISOString()).toBe(
      '2027-02-05T00:00:00.000Z'
    );
  });

  it('rejects scope and mode mismatches', () => {
    expect(() =>
      parseRazorpayOAuthTokenResponse(
        { ...response, scope: 'read_only' },
        'test'
      )
    ).toThrow(/incomplete/);
    expect(() => parseRazorpayOAuthTokenResponse(response, 'live')).toThrow(
      /mode/
    );
  });

  it('allows refresh responses to reuse bound identity and scope', () => {
    const {
      razorpay_account_id: _omittedAccount,
      scope: _omittedScope,
      ...refreshResponse
    } = response;
    void _omittedAccount;
    void _omittedScope;
    expect(
      parseRazorpayOAuthTokenResponse(
        refreshResponse,
        'test',
        new Date('2026-08-09T00:00:00Z'),
        'acc_123',
        'read_write'
      )
    ).toMatchObject({ accountId: 'acc_123', scope: 'read_write' });
  });
});

describe('Razorpay OAuth readiness', () => {
  it('falls back to read-only capability probes when an imported account rejects the account lookup', async () => {
    const paths: string[] = [];
    const readiness = await verifyRazorpayOAuthReadiness({
      accessToken: 'access',
      accountId: 'acc_imported',
      now: new Date('2026-08-09T00:00:00Z'),
      fetchImpl: async (input) => {
        const url = String(input);
        paths.push(new URL(url).pathname);
        return new Response(JSON.stringify({ items: [] }), {
          status: url.includes('/v2/accounts/') ? 400 : 200,
        });
      },
    });

    expect(readiness).toEqual({
      ready: true,
      merchantStatus: 'unknown',
      activationVerifiedAt: '2026-08-09T00:00:00.000Z',
      lastError: null,
    });
    expect(paths).toEqual([
      '/v2/accounts/acc_imported',
      '/v1/customers',
      '/v1/plans',
      '/v1/subscriptions',
      '/v1/payment_links',
      '/v1/payments',
    ]);
  });

  it('does not mask an unexpected account lookup failure', async () => {
    const readiness = await verifyRazorpayOAuthReadiness({
      accessToken: 'access',
      accountId: 'acc_imported',
      fetchImpl: async () => new Response(null, { status: 500 }),
    });

    expect(readiness).toMatchObject({
      ready: false,
      lastError: 'Razorpay readiness check failed (500)',
    });
  });
});
