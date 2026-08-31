import type { AuthState } from './auth-context';

export type AuthEntryRoute =
  '/(auth)/sign-in' | '/(auth)/select-branch' | '/(app)';

export function entryRouteForAuthState(
  state: AuthState
): AuthEntryRoute | null {
  switch (state.status) {
    case 'booting':
      return null;
    case 'signed_out':
      return '/(auth)/sign-in';
    case 'choose_branch':
    case 'blocked':
      return '/(auth)/select-branch';
    case 'ready':
      return '/(app)';
  }
}
