import {
  invitationJoinPath,
  normalizeInvitationToken,
} from './invitation-continuation';

export function postLoginDestination(inviteToken: string | null): string {
  return (
    invitationJoinPath(normalizeInvitationToken(inviteToken)) ?? '/dashboard'
  );
}

/** Force a top-level request so freshly written Supabase cookies reach proxy. */
export function navigateAfterLogin(
  inviteToken: string | null,
  location: Pick<Location, 'href'> = window.location
): void {
  location.href = postLoginDestination(inviteToken);
}
