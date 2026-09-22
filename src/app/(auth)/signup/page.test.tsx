// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const signUp = vi.hoisted(() => vi.fn());
let searchParams = new URLSearchParams({ invite: INVITE_TOKEN });

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp } }),
}));

vi.mock('@/components/auth/google-auth-button', () => ({
  GoogleAuthButton: ({
    inviteToken,
    gymName,
  }: {
    inviteToken: string | null;
    gymName?: string;
  }) => (
    <button data-invite-token={inviteToken ?? ''} data-gym-name={gymName ?? ''}>
      Continue with Google
    </button>
  ),
}));

const { default: SignupPage } = await import('./page');

beforeEach(() => {
  searchParams = new URLSearchParams({ invite: INVITE_TOKEN });
  signUp.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe('invitation signup continuation', () => {
  it('offers the shared Google continuation', () => {
    render(<SignupPage />);

    expect(
      screen
        .getByRole('button', { name: 'Continue with Google' })
        .getAttribute('data-invite-token')
    ).toBe(INVITE_TOKEN);
  });

  it('hides Gym name and omits its metadata for invitation signup', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    expect(screen.queryByLabelText('Gym name')).toBeNull();
    await user.type(screen.getByLabelText('Full name'), 'Invitee Person');
    await user.type(screen.getByLabelText('Email'), 'invitee@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-123');
    await user.type(screen.getByLabelText('Confirm password'), 'password-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(signUp).toHaveBeenCalledOnce());
    expect(signUp.mock.calls[0][0].options.data).not.toHaveProperty('gym_name');
  });

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

  it('shows in-button progress while account creation is pending', async () => {
    let resolveSignup!: (value: { error: { message: string } }) => void;
    signUp.mockReturnValue(
      new Promise((resolve) => {
        resolveSignup = resolve;
      })
    );
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.type(screen.getByLabelText('Full name'), 'Invitee Person');
    await user.type(screen.getByLabelText('Email'), 'invitee@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-123');
    await user.type(screen.getByLabelText('Confirm password'), 'password-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const submit = screen.getByRole('button', {
      name: 'Creating account...',
    });
    try {
      expect(submit.getAttribute('aria-busy')).toBe('true');
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(submit.querySelector('.animate-spin')).not.toBeNull();
    } finally {
      resolveSignup({ error: { message: 'Test signup stopped' } });
    }
    await screen.findByText('Test signup stopped');
  });
});

describe('new organization signup', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
  });

  it('places Gym name before Google and sends separate person and business metadata', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    const gymName = screen.getByLabelText('Gym name');
    const google = screen.getByRole('button', {
      name: 'Continue with Google',
    });
    expect(
      gymName.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await user.type(gymName, '  Iron House  ');
    expect(google.getAttribute('data-gym-name')).toBe('  Iron House  ');
    await user.type(screen.getByLabelText('Full name'), 'Owner Person');
    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-123');
    await user.type(screen.getByLabelText('Confirm password'), 'password-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(signUp).toHaveBeenCalledOnce());
    expect(signUp.mock.calls[0][0].options.data).toMatchObject({
      full_name: 'Owner Person',
      gym_name: 'Iron House',
    });
  });

  it('shows the shared inline error and does not submit an invalid gym name', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.type(screen.getByLabelText('Full name'), 'Owner Person');
    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'password-123');
    await user.type(screen.getByLabelText('Confirm password'), 'password-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/between 1 and 80/)).not.toBeNull();
    expect(signUp).not.toHaveBeenCalled();
  });
});
