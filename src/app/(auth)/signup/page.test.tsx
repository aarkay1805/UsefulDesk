// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const signUp = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ invite: INVITE_TOKEN }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp } }),
}));

const { default: SignupPage } = await import('./page');

beforeEach(() => {
  signUp.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe('invitation signup continuation', () => {
  it('puts the validated join destination into the verification callback', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.type(screen.getByLabelText('Full name'), 'Invitee Person');
    await user.type(screen.getByLabelText('Email'), 'invitee@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-123');
    await user.type(screen.getByLabelText('Confirm password'), 'password-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(signUp).toHaveBeenCalledOnce());
    const options = signUp.mock.calls[0][0].options as {
      emailRedirectTo: string;
    };
    const callback = new URL(options.emailRedirectTo);

    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(`/join/${INVITE_TOKEN}`);
  });
});
