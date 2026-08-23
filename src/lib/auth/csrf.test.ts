import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireSameOriginRequest } from './csrf';

describe('same-origin mutation guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts same-origin browser requests', () => {
    expect(() =>
      requireSameOriginRequest(
        new Request(
          'https://desk.example/api/payments/razorpay/oauth/connect',
          {
            headers: {
              origin: 'https://desk.example',
              'sec-fetch-site': 'same-origin',
            },
          }
        )
      )
    ).not.toThrow();
  });

  it('rejects missing and cross-site origins', () => {
    expect(() =>
      requireSameOriginRequest(
        new Request('https://desk.example/api/payments/razorpay/oauth/connect')
      )
    ).toThrow(/origin/);
    expect(() =>
      requireSameOriginRequest(
        new Request(
          'https://desk.example/api/payments/razorpay/oauth/connect',
          {
            headers: {
              origin: 'https://evil.example',
              'sec-fetch-site': 'cross-site',
            },
          }
        )
      )
    ).toThrow(/origin|Cross-site/);
  });

  it('accepts only the exact configured HTTPS development tunnel', () => {
    vi.stubEnv('META_REVIEW_TUNNEL_HOST', 'review-example.trycloudflare.com');

    const tunnelRequest = (origin: string, forwardedHost: string) =>
      new Request('http://localhost:3000/api/meta/leads/connect', {
        method: 'POST',
        headers: {
          origin,
          'sec-fetch-site': 'same-origin',
          'x-forwarded-host': forwardedHost,
          'x-forwarded-proto': 'https',
        },
      });

    expect(() =>
      requireSameOriginRequest(
        tunnelRequest(
          'https://review-example.trycloudflare.com',
          'review-example.trycloudflare.com'
        )
      )
    ).not.toThrow();
    expect(() =>
      requireSameOriginRequest(
        tunnelRequest(
          'https://attacker.example',
          'review-example.trycloudflare.com'
        )
      )
    ).toThrow(/origin/);
    expect(() =>
      requireSameOriginRequest(
        tunnelRequest(
          'https://review-example.trycloudflare.com',
          'attacker.example'
        )
      )
    ).toThrow(/origin/);
  });
});
