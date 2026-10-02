// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: api.rpc }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/platform-admin',
}));
import { StarterSignupQueue } from './starter-signup-queue';
const item = {
  organization_id: 'gym-1',
  name: 'Future gym',
  selected_at: '2026-10-02T18:00:00Z',
  operator_user_id: 'admin-1',
  operator_name: 'Rajat',
  review_status: 'commercial_review_required',
  access_status: 'trial',
  trial_ends_at: '2026-10-16T18:00:00Z',
  active_branches: 1,
  revision: 0,
  work_status: 'awaiting_facts',
  next_action: 'Collect actual buyer and setup details',
  evidence: {},
  snapshot_token: 'snapshot-1',
  missing_facts: ['buyer_details', 'gym_setup'],
  preparation_id: null,
  preparation_stale: false,
  branches: [
    {
      account_id: 'branch-1',
      name: 'First branch',
      currency: 'INR',
      buyer_complete: false,
      setup_complete: false,
    },
  ],
  operators: [{ user_id: 'admin-1', name: 'Rajat' }],
};
beforeEach(() =>
  api.rpc.mockImplementation(async (name: string) => {
    if (name === 'platform_admin_starter_signup_queue')
      return { data: { items: [item], total: 1 }, error: null };
    return { data: { revision: 1 }, error: null };
  })
);
afterEach(cleanup);
describe('Starter signup preparation queue', () => {
  it('shows actual accountable work and explains missing customer facts', async () => {
    render(<StarterSignupQueue />);
    expect(await screen.findByText('Future gym')).toBeTruthy();
    expect(screen.getByText('Rajat')).toBeTruthy();
    expect(
      screen.getByText('Collect actual buyer and setup details')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review preparation' }));
    expect(await screen.findByText('Complete buyer details')).toBeTruthy();
    expect(
      screen.getByText('Review gym setup and active plan prices')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open checkout' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Record owner approval' })
    ).toBeNull();
  });
  it('saves partial facts with current revision and snapshot without fabricating references', async () => {
    render(<StarterSignupQueue />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review preparation' })
    );
    fireEvent.change(await screen.findByLabelText('Next step'), {
      target: { value: 'Ask gym owner for actual billing details' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save preparation' }));
    await waitFor(() =>
      expect(api.rpc).toHaveBeenCalledWith(
        'platform_admin_save_starter_signup_work',
        {
          p_organization_id: 'gym-1',
          p_expected_revision: 0,
          p_expected_snapshot: 'snapshot-1',
          p_operator_user_id: 'admin-1',
          p_status: 'awaiting_facts',
          p_next_action: 'Ask gym owner for actual billing details',
          p_evidence: {},
        }
      )
    );
    expect(
      api.rpc.mock.calls.some(
        ([name]) => name === 'platform_admin_freeze_starter_signup_preparation'
      )
    ).toBe(false);
  });
  it('keeps save failure visible with refresh guidance and no success state', async () => {
    api.rpc.mockImplementation(async (name: string) =>
      name === 'platform_admin_starter_signup_queue'
        ? { data: { items: [item], total: 1 }, error: null }
        : {
            data: null,
            error: {
              message:
                'Preparation changed. Refresh and review the latest details.',
            },
          }
    );
    render(<StarterSignupQueue />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review preparation' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save preparation' })
    );
    expect(
      await screen.findByText(
        'Preparation changed. Refresh and review the latest details.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save preparation' })
    ).toBeTruthy();
  });
  it('shows an actionable empty queue without customer activation', async () => {
    api.rpc.mockResolvedValue({ data: { items: [], total: 0 }, error: null });
    render(<StarterSignupQueue />);
    expect(await screen.findByText(/No new gym businesses/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Review preparation' })
    ).toBeNull();
  });
  it('asks for a real review before freezing a complete saved preparation', async () => {
    const ready = {
      ...item,
      revision: 2,
      missing_facts: [],
      work_status: 'in_review',
      evidence: { authorization_reference: 'actual reviewed authorization' },
    };
    api.rpc.mockImplementation(async (name: string) =>
      name === 'platform_admin_starter_signup_queue'
        ? { data: { items: [ready], total: 1 }, error: null }
        : { data: { preparation_id: 'prepared-1' }, error: null }
    );
    render(<StarterSignupQueue />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review preparation' })
    );
    expect(
      (
        await screen.findByRole('button', { name: 'Freeze preparation' })
      ).hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I checked the buyer, setup and every saved review reference.',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Freeze preparation' }));
    await waitFor(() =>
      expect(api.rpc).toHaveBeenCalledWith(
        'platform_admin_freeze_starter_signup_preparation',
        {
          p_organization_id: 'gym-1',
          p_expected_revision: 2,
          p_confirm_reviewed: true,
        }
      )
    );
  });
  it('updates accountability on a frozen review while keeping evidence read-only', async () => {
    const frozen = {
      ...item,
      revision: 4,
      preparation_id: 'prepared-1',
      evidence: { authorization_reference: ' actual frozen authorization ' },
    };
    api.rpc.mockImplementation(async (name: string) =>
      name === 'platform_admin_starter_signup_queue'
        ? { data: { items: [frozen], total: 1 }, error: null }
        : { data: { revision: 5 }, error: null }
    );
    render(<StarterSignupQueue />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review preparation' })
    );
    expect(
      screen.getByLabelText('Operator authorization').hasAttribute('readonly')
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Next step'), {
      target: { value: 'Review changed buyer with release operator' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save preparation' }));
    await waitFor(() =>
      expect(api.rpc).toHaveBeenCalledWith(
        'platform_admin_save_starter_signup_work',
        expect.objectContaining({
          p_expected_revision: 4,
          p_next_action: 'Review changed buyer with release operator',
          p_evidence: frozen.evidence,
        })
      )
    );
    expect(
      screen.queryByRole('button', { name: 'Freeze preparation' })
    ).toBeNull();
  });
});
