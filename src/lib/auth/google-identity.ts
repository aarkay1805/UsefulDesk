export type GoogleNonce = {
  raw: string;
  hashed: string;
};

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
