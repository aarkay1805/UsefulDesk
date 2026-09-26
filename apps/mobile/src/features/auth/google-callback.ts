import 'react-native-url-polyfill/auto';

export type AuthorizationCodeResult =
  { status: 'code'; code: string } | { status: 'error'; message: string };

const INVALID_CALLBACK_MESSAGE = 'Could not sign in with Google. Try again.';

export function authorizationCodeFromCallback(
  callbackUrl: string
): AuthorizationCodeResult {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { status: 'error', message: INVALID_CALLBACK_MESSAGE };
  }

  if (
    parsed.protocol !== 'usefuldesk-agent:' ||
    parsed.hostname !== 'auth' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.port.length > 0 ||
    parsed.pathname !== '/callback' ||
    parsed.hash.length > 0
  ) {
    return { status: 'error', message: INVALID_CALLBACK_MESSAGE };
  }

  if (parsed.searchParams.has('error')) {
    return {
      status: 'error',
      message: 'Google sign-in did not finish. Try again.',
    };
  }

  const codes = parsed.searchParams.getAll('code');
  const unexpectedParameter = Array.from(parsed.searchParams.keys()).some(
    (key) => key !== 'code'
  );
  if (
    codes.length !== 1 ||
    unexpectedParameter ||
    codes[0].trim().length === 0
  ) {
    return {
      status: 'error',
      message: 'Could not sign in with Google. Try again.',
    };
  }

  return { status: 'code', code: codes[0] };
}
