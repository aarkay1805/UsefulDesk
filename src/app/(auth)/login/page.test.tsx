// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const signInWithPassword = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ invite: INVITE_TOKEN }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword },
  }),
}));

vi.mock('@/components/auth/google-auth-button', () => ({
  GoogleAuthButton: ({ inviteToken }: { inviteToken: string | null }) => (
    <button data-invite-token={inviteToken ?? ''}>Continue with Google</button>
  ),
}));

const { default: LoginPage } = await import('./page');

beforeEach(() => signInWithPassword.mockReset());

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

  it('passes the invitation into the direct Google sign-in control', () => {
    render(<LoginPage />);

    expect(
      screen
        .getByRole('button', { name: 'Continue with Google' })
        .getAttribute('data-invite-token')
    ).toBe(INVITE_TOKEN);
  });
});
