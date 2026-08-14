// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signInWithIdToken = vi.hoisted(() => vi.fn());
const generateGoogleNonce = vi.hoisted(() => vi.fn());
const navigateAfterLogin = vi.hoisted(() => vi.fn());

vi.mock('next/script', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  function MockScript({ onReady }: { onReady?: () => void }) {
    const onReadyRef = React.useRef(onReady);
    React.useEffect(() => onReadyRef.current?.(), []);
    return null;
  }

  return { default: MockScript };
});

vi.mock('@/lib/auth/google-identity', () => ({ generateGoogleNonce }));
vi.mock('@/lib/auth/post-login-navigation', () => ({ navigateAfterLogin }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithIdToken } }),
}));

const { GoogleAuthButton } = await import('./google-auth-button');

const initialize = vi.fn();
const renderButton = vi.fn(
  (parent: HTMLElement, options: { click_listener: () => void }) => {
    const button = document.createElement('button');
    button.textContent = 'Continue with Google';
    button.addEventListener('click', options.click_listener);
    parent.append(button);
  }
);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', 'true');
  vi.stubEnv(
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'public-client.apps.googleusercontent.com'
  );
  signInWithIdToken.mockReset().mockResolvedValue({ error: null });
  generateGoogleNonce.mockReset().mockResolvedValue({
    raw: 'raw-nonce-1',
    hashed: 'hashed-nonce-1',
  });
  navigateAfterLogin.mockReset();
  initialize.mockReset();
  renderButton.mockClear();
  Object.assign(window, {
    google: { accounts: { id: { initialize, renderButton } } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, 'google');
});

describe('GoogleAuthButton', () => {
  it('uses the Google-rendered FedCM button and exchanges its token with the raw nonce', async () => {
    const user = userEvent.setup();
    const onErrorChange = vi.fn();
    render(
      <GoogleAuthButton
        inviteToken="invite-token"
        onErrorChange={onErrorChange}
      />
    );

    const googleButton = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    const config = initialize.mock.calls[0][0] as {
      callback: (response: { credential: string }) => void;
      client_id: string;
      nonce: string;
      use_fedcm_for_button: boolean;
    };

    expect(config).toMatchObject({
      client_id: 'public-client.apps.googleusercontent.com',
      nonce: 'hashed-nonce-1',
      use_fedcm_for_button: true,
    });

    await user.click(googleButton);
    expect(
      screen
        .getByRole('button', { name: 'Waiting for Google…' })
        .hasAttribute('disabled')
    ).toBe(true);

    config.callback({ credential: 'google-id-token' });

    await waitFor(() =>
      expect(signInWithIdToken).toHaveBeenCalledWith({
        provider: 'google',
        token: 'google-id-token',
        nonce: 'raw-nonce-1',
      })
    );
    await waitFor(() =>
      expect(navigateAfterLogin).toHaveBeenCalledWith('invite-token')
    );
  });

  it('creates a fresh nonce when a dismissed FedCM or popup attempt is retried', async () => {
    const user = userEvent.setup();
    generateGoogleNonce
      .mockResolvedValueOnce({ raw: 'raw-nonce-1', hashed: 'hashed-nonce-1' })
      .mockResolvedValueOnce({ raw: 'raw-nonce-2', hashed: 'hashed-nonce-2' });

    render(<GoogleAuthButton inviteToken={null} onErrorChange={vi.fn()} />);

    await user.click(
      await screen.findByRole('button', { name: 'Continue with Google' })
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Google window closed? Try again',
      })
    );

    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(generateGoogleNonce).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[0][0]).toMatchObject({
      nonce: 'hashed-nonce-1',
    });
    expect(initialize.mock.calls[1][0]).toMatchObject({
      nonce: 'hashed-nonce-2',
      use_fedcm_for_button: false,
    });
  });

  it('surfaces a token-exchange error and restores a new Google attempt', async () => {
    const onErrorChange = vi.fn();
    generateGoogleNonce
      .mockResolvedValueOnce({ raw: 'raw-nonce-1', hashed: 'hashed-nonce-1' })
      .mockResolvedValueOnce({ raw: 'raw-nonce-2', hashed: 'hashed-nonce-2' });
    signInWithIdToken.mockResolvedValueOnce({
      error: new Error('Google token was rejected'),
    });

    render(
      <GoogleAuthButton inviteToken={null} onErrorChange={onErrorChange} />
    );

    await screen.findByRole('button', { name: 'Continue with Google' });
    const config = initialize.mock.calls[0][0] as {
      callback: (response: { credential: string }) => void;
    };
    config.callback({ credential: 'rejected-token' });

    await waitFor(() =>
      expect(onErrorChange).toHaveBeenCalledWith('Google token was rejected')
    );
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(generateGoogleNonce).toHaveBeenCalledTimes(2);
  });
});
