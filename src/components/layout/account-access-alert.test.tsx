import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  accountStatus: 'ready' as 'loading' | 'ready' | 'unlinked' | 'error',
  accountStatusDetail: null as string | null,
  refreshProfile: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => authState,
}));

const { AccountAccessAlert } = await import('./account-access-alert');

describe('AccountAccessAlert', () => {
  beforeEach(() => {
    authState.accountStatus = 'ready';
    authState.accountStatusDetail = null;
  });

  it('renders nothing for a resolved account role', () => {
    expect(renderToStaticMarkup(<AccountAccessAlert />)).toBe('');
  });

  it('explains a failed permission lookup with a retry action', () => {
    authState.accountStatus = 'error';
    authState.accountStatusDetail = 'connection unavailable';

    const markup = renderToStaticMarkup(<AccountAccessAlert />);

    expect(markup).toContain('Could not load your permissions');
    expect(markup).toContain('Support detail: connection unavailable');
    expect(markup).toContain('Retry');
  });

  it('explains an unlinked account without granting access', () => {
    authState.accountStatus = 'unlinked';

    const markup = renderToStaticMarkup(<AccountAccessAlert />);

    expect(markup).toContain('Your login is not linked to an account');
    expect(markup).toContain(
      'Changes cannot be saved until access is restored'
    );
  });
});
