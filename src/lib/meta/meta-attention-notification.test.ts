import { describe, expect, it } from 'vitest';

import { notificationDestination } from './meta-attention-notification';

describe('Meta attention notification destination', () => {
  it('opens the branch-scoped Lead capture settings section', () => {
    expect(
      notificationDestination({
        type: 'meta_leads_attention',
        account_id: '11111111-1111-4111-8111-111111111111',
      })
    ).toBe('/settings?tab=capture&branch=11111111-1111-4111-8111-111111111111');
  });
});
