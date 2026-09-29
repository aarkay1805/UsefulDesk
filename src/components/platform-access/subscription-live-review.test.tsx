// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      money: (amount: number) => `₹${amount.toFixed(2)}`,
      dateTime: (value: string) => value,
    },
  }),
}));
import { SubscriptionLiveReview } from './subscription-live-review';

const organizationId = '11111111-1111-4111-8111-111111111111';
const quote = {
  request_id: '22222222-2222-4222-8222-222222222222',
  tier: 'starter',
  amount_minor: 79947,
  currency: 'INR',
  expires_at: '2099-09-29T00:00:00Z',
  starter_reminder_reset_accepted: false,
  starter_reminder_policy_version: null,
  approved_starter_reminder_policy: {
    version: 'approved-v1',
    days_before: [7, 3, 1],
    hour_local: 9,
  },
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_quote'
        ? quote
        : { request_id: quote.request_id, policy_version: 'approved-v1' },
    error: null,
  }));
});
afterEach(cleanup);

describe('owner Live pilot review', () => {
  it('shows the frozen amount with pilot labeling and no payment action', async () => {
    render(<SubscriptionLiveReview organizationId={organizationId} />);
    expect(await screen.findByText('Usefulmade Live pilot')).toBeTruthy();
    expect(screen.getByText('₹799.47 for one month')).toBeTruthy();
    expect(
      screen.getByText('Payment for this Live pilot is not available yet.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull();
  });

  it('saves Starter reminder acceptance only after the owner checks it', async () => {
    render(<SubscriptionLiveReview organizationId={organizationId} />);
    const button = await screen.findByRole('button', {
      name: 'Save reminder choice',
    });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        'subscription_acknowledge_live_starter_reminders',
        { p_request_id: quote.request_id }
      )
    );
  });
});
