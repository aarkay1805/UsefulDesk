import { describe, expect, it } from 'vitest';

import {
  buildMemberPurchaseHref,
  resolveMemberPurchaseReturn,
} from './member-purchase-navigation';

describe('member purchase navigation', () => {
  it('retains the active branch and members view when opening checkout', () => {
    expect(
      buildMemberPurchaseHref(
        'http://localhost:3000/members?branch=branch-id&view=all',
        'membership-id'
      )
    ).toBe(
      '/members/purchase?membership=membership-id&branch=branch-id&returnTo=%2Fmembers%3Fbranch%3Dbranch-id%26view%3Dall%26member%3Dmembership-id'
    );
  });

  it('adds the member profile to a valid Members return destination', () => {
    expect(
      resolveMemberPurchaseReturn('/members?view=all', 'membership-id')
    ).toBe('/members?view=all&member=membership-id');
  });

  it.each(['https://evil.example', '/finance', 'javascript:alert(1)'])(
    'falls back safely for return destination %s',
    (returnTo) => {
      expect(resolveMemberPurchaseReturn(returnTo, 'membership-id')).toBe(
        '/members?member=membership-id'
      );
    }
  );

  it('omits an empty member identifier from the recovery destination', () => {
    expect(resolveMemberPurchaseReturn(null, '')).toBe('/members');
  });
});
