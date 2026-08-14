import { postLoginDestination } from './post-login-navigation';

/** Build the allow-listed PKCE callback while retaining a validated invite. */
export function oauthCallbackUrl(
  origin: string,
  inviteToken: string | null
): string {
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', postLoginDestination(inviteToken));
  return callback.toString();
}
