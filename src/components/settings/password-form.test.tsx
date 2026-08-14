// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateUser = vi.hoisted(() => vi.fn());
const signInWithPassword = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'account@example.com' } }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword, updateUser } }),
}));

const { PasswordForm } = await import('./password-form');

beforeEach(() => {
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  updateUser.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe('PasswordForm', () => {
  it('changes a linked password with current-password proof in one request', async () => {
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    render(<PasswordForm onUpdated={onUpdated} />);

    await user.type(screen.getByLabelText('Current password'), 'old-password');
    await user.type(screen.getByLabelText('New password'), 'new-password');
    await user.type(
      screen.getByLabelText('Confirm new password'),
      'new-password'
    );
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'account@example.com',
        password: 'old-password',
      })
    );
    expect(updateUser).toHaveBeenCalledWith({
      password: 'new-password',
      current_password: 'old-password',
    });
    expect(onUpdated).toHaveBeenCalledOnce();
  });
});
