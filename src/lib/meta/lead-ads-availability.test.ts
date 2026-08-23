import { describe, expect, it } from 'vitest';

import {
  META_LEADS_REVIEW_ACCOUNT_ID,
  META_LEADS_REVIEW_CONFIG_ID,
  resolveMetaLeadsConfigId,
} from './lead-ads-availability';

describe('Meta Lead Ads availability', () => {
  it('exposes the review configuration only to the dedicated review account', () => {
    expect(
      resolveMetaLeadsConfigId(undefined, META_LEADS_REVIEW_ACCOUNT_ID)
    ).toBe(META_LEADS_REVIEW_CONFIG_ID);

    expect(
      resolveMetaLeadsConfigId(
        undefined,
        '11111111-1111-4111-8111-111111111111'
      )
    ).toBeUndefined();
    expect(resolveMetaLeadsConfigId(undefined, null)).toBeUndefined();
  });

  it('uses the configured dark-launch value when it is present', () => {
    expect(resolveMetaLeadsConfigId('configured-id', null)).toBe(
      'configured-id'
    );
    expect(
      resolveMetaLeadsConfigId('configured-id', META_LEADS_REVIEW_ACCOUNT_ID)
    ).toBe('configured-id');
  });
});
