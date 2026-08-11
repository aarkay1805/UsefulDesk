export function postLoginDestination(inviteToken: string | null): string {
  return inviteToken
    ? `/join/${encodeURIComponent(inviteToken)}`
    : '/dashboard';
}

/** Force a top-level request so freshly written Supabase cookies reach proxy. */
export function navigateAfterLogin(
  inviteToken: string | null,
  location: Pick<Location, 'href'> = window.location
): void {
  location.href = postLoginDestination(inviteToken);
}
