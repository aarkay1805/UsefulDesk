// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const completeSignup = vi.hoisted(() => vi.fn());
const navigateToCompletedBranch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/complete-signup-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/complete-signup-client')
  >('@/lib/auth/complete-signup-client');
  return {
    ...actual,
    completeSignup,
    navigateToCompletedBranch,
  };
});

const { CompleteSignupForm } = await import('./complete-signup-form');

beforeEach(() => {
  sessionStorage.clear();
  completeSignup.mockReset().mockResolvedValue('completed');
  navigateToCompletedBranch.mockReset();
});

afterEach(cleanup);

describe('CompleteSignupForm', () => {
  it('prefills the same-tab draft, completes the explicit branch, and clears the draft', async () => {
    sessionStorage.setItem('usefuldesk.signup.gym-name', '  Iron House  ');
    const user = userEvent.setup();
    render(<CompleteSignupForm accountId="branch-id" />);

    await waitFor(() =>
      expect(
        (screen.getByLabelText('Gym name') as HTMLInputElement).value
      ).toBe('  Iron House  ')
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue to UsefulDesk' })
    );

    await waitFor(() =>
      expect(completeSignup).toHaveBeenCalledWith('branch-id', 'Iron House')
    );
    expect(sessionStorage.getItem('usefuldesk.signup.gym-name')).toBeNull();
    expect(navigateToCompletedBranch).toHaveBeenCalledWith('branch-id');
  });

  it('shows inline validation without making a request', async () => {
    const user = userEvent.setup();
    render(<CompleteSignupForm accountId="branch-id" />);

    await user.click(
      screen.getByRole('button', { name: 'Continue to UsefulDesk' })
    );
    expect(await screen.findByText(/1 to 80 letters/)).not.toBeNull();
    expect(screen.getByLabelText('Gym name').getAttribute('aria-invalid')).toBe(
      'true'
    );
    expect(completeSignup).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows a retryable error when completion fails', async () => {
    completeSignup.mockRejectedValueOnce(new Error('Please try again later'));
    const user = userEvent.setup();
    render(<CompleteSignupForm accountId="branch-id" />);

    await user.type(screen.getByLabelText('Gym name'), 'Iron House');
    await user.click(
      screen.getByRole('button', { name: 'Continue to UsefulDesk' })
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Please try again later'
    );
    expect(sessionStorage.getItem('usefuldesk.signup.gym-name')).toBe(
      'Iron House'
    );
    expect(navigateToCompletedBranch).not.toHaveBeenCalled();
  });
});
