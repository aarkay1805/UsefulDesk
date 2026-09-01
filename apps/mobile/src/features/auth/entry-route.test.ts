import type { AuthState } from './auth-context';
import { entryRouteForAuthState } from './entry-route';

describe('entryRouteForAuthState', () => {
  it.each([
    ['signed_out', '/(auth)/sign-in'],
    ['signing_out', '/(auth)/sign-in'],
    ['cleanup_failed', '/(auth)/sign-in'],
    ['choose_branch', '/(auth)/select-branch'],
    ['ready', '/(app)'],
    ['blocked', '/(auth)/select-branch'],
  ] as const)('routes %s auth state to %s', (status, expected) => {
    expect(entryRouteForAuthState({ status } as AuthState)).toBe(expected);
  });

  it('keeps the native splash mounted while auth is booting', () => {
    expect(entryRouteForAuthState({ status: 'booting' })).toBeNull();
  });
});
