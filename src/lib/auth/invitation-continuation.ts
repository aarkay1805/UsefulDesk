const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Accept only tokens in the 32-byte base64url format UsefulDesk issues. */
export function normalizeInvitationToken(
  value: string | null | undefined
): string | null {
  return value && INVITATION_TOKEN_PATTERN.test(value) ? value : null;
}

/** Turn a validated token into the only supported auth continuation path. */
export function invitationJoinPath(
  value: string | null | undefined
): string | null {
  const token = normalizeInvitationToken(value);
  return token ? `/join/${token}` : null;
}

/** Extract a token only from an exact internal invitation path. */
export function invitationTokenFromPath(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const match = /^\/join\/([^/?#]+)$/.exec(value);
  return normalizeInvitationToken(match?.[1]);
}

/** Add an invitation query only to a caller-selected internal auth page. */
export function withInvitation(
  path: string,
  value: string | null | undefined
): string {
  const token = normalizeInvitationToken(value);
  if (!token) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}invite=${encodeURIComponent(token)}`;
}

/** Accept a signed/server-returned invitation path, otherwise use the default. */
export function invitationDestinationOr(
  value: string | null | undefined,
  fallback: string
): string {
  const token = invitationTokenFromPath(value);
  return invitationJoinPath(token) ?? fallback;
}
