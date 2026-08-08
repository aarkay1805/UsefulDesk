import { describe, expect, it } from 'vitest';

import { requireSameOriginRequest } from './csrf';

describe('same-origin mutation guard', () => {
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
});
