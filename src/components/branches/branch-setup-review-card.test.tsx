// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BranchSetupReviewCard } from './branch-setup-review-card';

const auth = vi.hoisted(() => ({
  account: {
    id: '11111111-1111-4111-8111-111111111111',
    branch_status: 'active' as const,
    readiness_state: 'setup' as const,
    setup_reviewed_at: null as string | null,
  },
  accountRole: 'owner' as 'owner' | 'admin' | 'agent' | 'viewer',
  refreshProfile: vi.fn(),
}));

const query = vi.hoisted(() => {
  const value = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
  };
  return value;
});

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => query,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  auth.accountRole = 'owner';
  auth.account.readiness_state = 'setup';
  auth.account.setup_reviewed_at = null;
  auth.refreshProfile.mockReset().mockResolvedValue(undefined);
  query.from.mockReset().mockReturnValue(query);
  query.select.mockReset().mockReturnValue(query);
  query.eq
    .mockReset()
    .mockReturnValueOnce(query)
    .mockResolvedValueOnce({
      data: [
        {
          is_active: true,
          pricing_options: [{ is_active: true }],
        },
      ],
      error: null,
    });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BranchSetupReviewCard', () => {
  it('refreshes auth/account context after setup completion', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accountId: auth.account.id,
          readinessState: 'ready',
          setupReviewedAt: '2026-08-13T00:00:00.000Z',
          setupReviewedBy: '22222222-2222-4222-8222-222222222222',
          alreadyComplete: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<BranchSetupReviewCard />);
    const complete = await screen.findByRole('button', {
      name: 'Mark configuration reviewed',
    });
    await user.click(complete);

    await waitFor(() => expect(auth.refreshProfile).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/organization/branches/${auth.account.id}/complete-setup`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ configurationReviewed: true }),
      })
    );
  });

  it('shows lower roles status without a completion affordance', async () => {
    auth.accountRole = 'agent';
    render(<BranchSetupReviewCard />);

    expect(await screen.findByText('Setup')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Mark configuration reviewed' })
    ).toBeNull();
  });
});
