import { describe, expect, it } from 'vitest';
import type { UserIdentity } from '@supabase/supabase-js';

import { summarizeAuthIdentities } from './identity-summary';

function identity(provider: string, email: string | null): UserIdentity {
  return {
    id: `${provider}-id`,
    identity_id: `${provider}-identity-id`,
    user_id: 'user-id',
    provider,
    identity_data: email ? { email } : {},
  };
}

describe('summarizeAuthIdentities', () => {
  it('classifies a Google-only account from linked identities', () => {
    expect(
      summarizeAuthIdentities([identity('google', 'g@example.com')])
    ).toMatchObject({
      googleEmail: 'g@example.com',
      hasPassword: false,
    });
  });

  it('classifies a password-only account from the email identity', () => {
    expect(
      summarizeAuthIdentities([identity('email', 'p@example.com')])
    ).toEqual({
      googleIdentity: null,
      googleEmail: null,
      hasPassword: true,
    });
  });

  it('preserves both methods and the provider-specific Google email', () => {
    expect(
      summarizeAuthIdentities([
        identity('email', 'account@example.com'),
        identity('google', 'google@example.com'),
      ])
    ).toMatchObject({ googleEmail: 'google@example.com', hasPassword: true });
  });
});
