import { invitationDestinationOr } from './invitation-continuation';

export const LOGIN_SECURITY_PATH = '/settings?tab=security';

/** Allow only the two recovery continuations UsefulDesk intentionally owns. */
export function recoveryDestinationOr(
  value: string | null | undefined,
  fallback: string
): string {
  if (value === LOGIN_SECURITY_PATH) return LOGIN_SECURITY_PATH;
  return invitationDestinationOr(value, fallback);
}
