// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const INVITE_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
const push = vi.hoisted(() => vi.fn());
let postResponse: Promise<Response>;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams({ invite: INVITE_TOKEN }),
}));

const { default: ResetPasswordPage } = await import('./page');

beforeEach(() => {
  push.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  postResponse = Promise.resolve(
    new Response(JSON.stringify({ ok: true, next: `/join/${INVITE_TOKEN}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return postResponse;
      }
      return new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('password reset completion', () => {
  it('shows in-button progress while the password update is pending', async () => {
    let resolvePost!: (value: Response) => void;
    postResponse = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ResetPasswordPage />);

    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Update password',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    await user.type(screen.getByLabelText('New password'), 'new-password');
    await user.type(
      screen.getByLabelText('Confirm new password'),
      'new-password'
    );
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    const submit = screen.getByRole('button', { name: 'Updating...' });
    try {
      expect(submit.getAttribute('aria-busy')).toBe('true');
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(submit.querySelector('.animate-spin')).not.toBeNull();
    } finally {
      resolvePost(
        new Response(JSON.stringify({ error: 'Test update stopped' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    await screen.findByText('Test update stopped');
  });

  it('continues to the signed invitation destination after success', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ResetPasswordPage />);

    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Update password',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    await user.type(screen.getByLabelText('New password'), 'new-password');
    await user.type(
      screen.getByLabelText('Confirm new password'),
      'new-password'
    );
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await screen.findByText('Password updated');

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });

    expect(push).toHaveBeenCalledWith(`/join/${INVITE_TOKEN}`);
  });
});
