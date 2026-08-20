// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const resetPasswordForEmail = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ invite: INVITE_TOKEN }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { resetPasswordForEmail } }),
}));

const { default: ForgotPasswordPage } = await import('./page');

beforeEach(() => {
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe('invitation password recovery continuation', () => {
  it('puts the validated join destination into the recovery callback', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email'), 'invitee@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledOnce());
    const options = resetPasswordForEmail.mock.calls[0][1] as {
      redirectTo: string;
    };
    const callback = new URL(options.redirectTo);

    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(`/join/${INVITE_TOKEN}`);
    expect(
      screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')
    ).toBe(`/login?invite=${INVITE_TOKEN}`);
  });

  it('shows in-button progress while the reset email is pending', async () => {
    let resolveReset!: (value: { error: { message: string } }) => void;
    resetPasswordForEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveReset = resolve;
      })
    );
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email'), 'invitee@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    const submit = screen.getByRole('button', { name: 'Sending...' });
    try {
      expect(submit.getAttribute('aria-busy')).toBe('true');
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(submit.querySelector('.animate-spin')).not.toBeNull();
    } finally {
      resolveReset({ error: { message: 'Test reset stopped' } });
    }
    await screen.findByText('Test reset stopped');
  });
});
