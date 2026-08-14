// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const signInWithPassword = vi.hoisted(() => vi.fn());
const signInWithOAuth = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ invite: INVITE_TOKEN }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword, signInWithOAuth },
  }),
}));

const { default: LoginPage } = await import('./page');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', 'true');
  signInWithPassword.mockReset();
  signInWithOAuth.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe('invitation login continuation', () => {
  it('carries the invitation into forgot-password recovery', () => {
    render(<LoginPage />);

    expect(
      screen
        .getByRole('link', { name: 'Forgot password?' })
        .getAttribute('href')
    ).toBe(`/forgot-password?invite=${INVITE_TOKEN}`);
  });

  it('starts Google PKCE sign-in through the shared invitation callback', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledOnce());
    const request = signInWithOAuth.mock.calls[0][0] as {
      provider: string;
      options: { redirectTo: string };
    };
    const callback = new URL(request.options.redirectTo);

    expect(request.provider).toBe('google');
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(`/join/${INVITE_TOKEN}`);
  });
});
