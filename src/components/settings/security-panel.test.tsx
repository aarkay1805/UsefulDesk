// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserIdentity } from '@supabase/supabase-js';

const getUserIdentities = vi.hoisted(() => vi.fn());
const resetPasswordForEmail = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
const signInWithPassword = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-id', email: 'account@example.com' },
    profile: { email: 'account@example.com' },
    refreshProfile: vi.fn(),
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUserIdentities,
      resetPasswordForEmail,
      signInWithPassword,
      updateUser,
    },
  }),
}));

const { SecurityPanel } = await import('./security-panel');

function identity(provider: string, email: string): UserIdentity {
  return {
    id: `${provider}-id`,
    identity_id: `${provider}-identity-id`,
    user_id: 'user-id',
    provider,
    identity_data: { email },
  };
}

beforeEach(() => {
  getUserIdentities.mockReset();
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  updateUser.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe('SecurityPanel identity-aware settings', () => {
  it('shows Google-only users a read-only email and verified Add password action', async () => {
    const user = userEvent.setup();
    getUserIdentities.mockResolvedValue({
      data: { identities: [identity('google', 'google@example.com')] },
      error: null,
    });
    render(<SecurityPanel />);

    expect(await screen.findByText('google@example.com')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByLabelText('Email').hasAttribute('readonly')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Add password' }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledOnce());
    expect(resetPasswordForEmail.mock.calls[0][0]).toBe('account@example.com');
    expect(resetPasswordForEmail.mock.calls[0][1].redirectTo).toBe(
      'http://localhost:3000/auth/callback?next=%2Fsettings%3Ftab%3Dsecurity'
    );
  });

  it('shows both linked methods and keeps account email separate from Google', async () => {
    const user = userEvent.setup();
    getUserIdentities.mockResolvedValue({
      data: {
        identities: [
          identity('email', 'account@example.com'),
          identity('google', 'google@example.com'),
        ],
      },
      error: null,
    });
    render(<SecurityPanel />);

    expect(await screen.findByLabelText('Current password')).toBeTruthy();
    expect(
      screen.getByText(/Changing your account email does not disconnect Google/)
    ).toBeTruthy();

    const email = screen.getByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'new@example.com');
    expect((email as HTMLInputElement).value).toBe('new@example.com');
    const changeEmail = screen.getByRole('button', { name: 'Change email' });
    expect(changeEmail.hasAttribute('disabled')).toBe(false);
    await user.click(changeEmail);

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        { email: 'new@example.com' },
        {
          emailRedirectTo:
            'http://localhost:3000/auth/callback?next=%2Fsettings%3Ftab%3Dsecurity',
        }
      )
    );
  });

  it('surfaces identity load failure and retries the authoritative API', async () => {
    const user = userEvent.setup();
    getUserIdentities
      .mockResolvedValueOnce({ data: null, error: new Error('Network down') })
      .mockResolvedValueOnce({
        data: { identities: [identity('email', 'account@example.com')] },
        error: null,
      });
    render(<SecurityPanel />);

    expect(await screen.findByText('Sign-in methods unavailable')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Sign out everywhere' })
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText('Current password')).toBeTruthy();
    expect(getUserIdentities).toHaveBeenCalledTimes(2);
  });
});
