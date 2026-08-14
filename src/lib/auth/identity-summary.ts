import type { UserIdentity } from '@supabase/supabase-js';

export interface AuthIdentitySummary {
  googleIdentity: UserIdentity | null;
  googleEmail: string | null;
  hasPassword: boolean;
}

function identityEmail(identity: UserIdentity): string | null {
  const email = identity.identity_data?.email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

/**
 * Build the settings view from Supabase's linked identities. Session provider
 * metadata is intentionally excluded: it describes the latest sign-in, not
 * every method the account can use.
 */
export function summarizeAuthIdentities(
  identities: UserIdentity[]
): AuthIdentitySummary {
  const googleIdentity =
    identities.find((identity) => identity.provider === 'google') ?? null;

  return {
    googleIdentity,
    googleEmail: googleIdentity ? identityEmail(googleIdentity) : null,
    hasPassword: identities.some((identity) => identity.provider === 'email'),
  };
}
