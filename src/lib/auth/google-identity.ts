import type { User } from '@supabase/supabase-js';

export type GoogleNonce = {
  raw: string;
  hashed: string;
};

export const GOOGLE_AVATAR_SEED_METADATA_KEY =
  'usefuldesk_google_avatar_seed_attempted';

type GoogleAvatarUser = Pick<
  User,
  'id' | 'created_at' | 'last_sign_in_at' | 'user_metadata'
>;

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    ''
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

/**
 * Generate the nonce pair required by Google Identity Services + Supabase.
 * Google receives only the SHA-256 hex digest; Supabase receives the raw value.
 */
export async function generateGoogleNonce(
  cryptoSource: Pick<Crypto, 'getRandomValues' | 'subtle'> = crypto
): Promise<GoogleNonce> {
  const randomBytes = cryptoSource.getRandomValues(new Uint8Array(32));
  const raw = bytesToBase64Url(randomBytes);
  const digest = await cryptoSource.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw)
  );

  return {
    raw,
    hashed: bytesToHex(new Uint8Array(digest)),
  };
}

/**
 * Return Google's initial photo only during the account's first sign-in.
 * Later Google sessions—including every session after a UsefulDesk Remove—
 * return null, so a user-selected absence remains authoritative.
 */
export function resolveInitialGoogleAvatar(
  user: GoogleAvatarUser
): { userId: string; url: string } | null {
  if (user.user_metadata[GOOGLE_AVATAR_SEED_METADATA_KEY] === true) return null;

  const createdAt = Date.parse(user.created_at);
  const lastSignInAt = Date.parse(user.last_sign_in_at ?? '');
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(lastSignInAt) ||
    Math.abs(lastSignInAt - createdAt) > 60_000
  ) {
    return null;
  }

  const candidate = user.user_metadata.picture ?? user.user_metadata.avatar_url;
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:'
      ? { userId: user.id, url: url.href }
      : null;
  } catch {
    return null;
  }
}
