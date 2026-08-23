import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { resolveMetaLeadgenVerifyToken } from './webhook-verify-token';

describe('Meta leadgen webhook verify token', () => {
  it('prefers the dedicated configured token', () => {
    expect(
      resolveMetaLeadgenVerifyToken({
        META_LEADGEN_VERIFY_TOKEN: ' dedicated-token ',
        META_APP_SECRET: 'app-secret',
      })
    ).toBe('dedicated-token');
  });

  it('derives a stable domain-separated fallback from the app secret', () => {
    const expected = createHmac('sha256', 'app-secret')
      .update('usefuldesk:meta-leadgen:webhook-verify:v1')
      .digest('hex');

    expect(
      resolveMetaLeadgenVerifyToken({
        META_APP_SECRET: 'app-secret',
      })
    ).toBe(expected);
  });

  it('fails closed when neither source is configured', () => {
    expect(resolveMetaLeadgenVerifyToken({})).toBeNull();
  });
});
