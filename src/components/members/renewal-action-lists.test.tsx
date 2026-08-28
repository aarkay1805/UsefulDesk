// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  loadPage: vi.fn(),
  loadCount: vi.fn(),
}));

vi.mock('@/lib/memberships/renewal-queue', () => ({
  loadRenewalQueuePage: h.loadPage,
  loadRenewalQueueCount: h.loadCount,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ marker: 'browser-rls-client' }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-1',
    canSendMessages: true,
    accountRole: 'owner',
  }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      today: () => '2026-08-28',
      date: (value: string) => value,
      money: (value: number) => `INR ${value}`,
    },
  }),
}));
vi.mock('./member-identity', () => ({
  MemberIdentity: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock('./member-avatar-quick-view', () => ({
  buildMemberAvatarPreview: () => undefined,
}));
vi.mock('./send-reminder-button', () => ({
  SendReminderButton: () => null,
}));
vi.mock('@/components/follow-ups/follow-up-button', () => ({
  FollowUpButton: () => null,
}));
vi.mock('@/components/follow-ups/follow-up-dialog', () => ({
  FollowUpDialog: () => null,
}));
vi.mock('./renew-membership-dialog', () => ({
  RenewMembershipDialog: () => null,
}));
vi.mock('./service-renewal-action-lists', () => ({
  ServiceRenewalActionLists: () => null,
}));

const { RenewalActionLists } = await import('./renewal-action-lists');

const readiness = {
  loading: false,
  ready: false,
  reason: 'Unavailable in this test',
  resolution: null,
  templateLanguage: 'en_US',
  templateName: 'gym_membership_renewal',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function membership(id: string, name: string) {
  return {
    id,
    account_id: 'account-1',
    contact_id: `contact-${id}`,
    member_number: 1001,
    user_id: null,
    plan_id: 'plan-1',
    pricing_option_id: 'option-1',
    start_date: '2026-08-01',
    end_date: '2026-09-01',
    status: 'active',
    fee_amount: 1000,
    fee_status: 'paid',
    is_trial: false,
    collection_mode: 'manual',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    contact: { name, phone: '+919999999999', avatar_url: null },
    plan: { name: 'Monthly', plan_type: 'recurring' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('RenewalActionLists visible-row sequencing', () => {
  it('renders the active page without issuing the default all-time expired count', async () => {
    const page = deferred<{
      rows: ReturnType<typeof membership>[];
      total: number;
    }>();
    h.loadPage.mockReturnValue(page.promise);
    h.loadCount.mockReturnValue(new Promise(() => {}));

    render(
      <RenewalActionLists
        readiness={readiness}
        onSelect={vi.fn()}
        reloadKey={0}
      />
    );

    expect(h.loadPage).toHaveBeenCalledOnce();
    expect(h.loadCount).not.toHaveBeenCalled();

    page.resolve({ rows: [membership('member-1', 'Visible Asha')], total: 1 });

    expect(await screen.findByText('Visible Asha')).toBeTruthy();
    expect(h.loadCount).not.toHaveBeenCalled();
  });

  it('loads an accurate all-time expired count only when Expired is selected', async () => {
    const user = userEvent.setup();
    const inactiveCount = deferred<number>();
    h.loadCount.mockReturnValue(inactiveCount.promise);
    h.loadPage
      .mockResolvedValueOnce({
        rows: [membership('member-1', 'Expiring Asha')],
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [membership('member-2', 'Expired Dev')],
        total: 42,
      });

    render(
      <RenewalActionLists
        readiness={readiness}
        onSelect={vi.fn()}
        reloadKey={0}
      />
    );

    await screen.findByText('Expiring Asha');
    expect(h.loadCount).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Expired memberships' })
    );

    expect(await screen.findByText('Expired Dev')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Expired memberships' }).textContent
      ).toContain('42')
    );
    expect(h.loadPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: 'expired', days: null, page: 0 })
    );
    expect(h.loadCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: 'expiring', days: 7 })
    );
  });
});
