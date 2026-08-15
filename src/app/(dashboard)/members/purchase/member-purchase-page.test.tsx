// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '@/types';

const { authState, queryState, routerPush } = vi.hoisted(() => ({
  authState: {
    accountRole: 'agent' as 'agent' | 'viewer' | null,
    profileLoading: false,
  },
  queryState: {
    data: null as Membership | null,
    error: null as { message: string } | null,
  },
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      date: (value: string) => (value === '2026-09-15' ? '15 Sep 2026' : value),
    },
  }),
}));

const membershipQuery = {
  select: vi.fn(() => membershipQuery),
  eq: vi.fn(() => membershipQuery),
  maybeSingle: vi.fn(() => Promise.resolve(queryState)),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => membershipQuery,
  }),
}));

vi.mock('@/components/layout/page-header-actions', () => ({
  PageHeaderActions: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-header-actions">{children}</div>
  ),
}));

vi.mock('@/components/members/product-service-sale-checkout', () => ({
  ProductServiceSaleCheckout: ({ onSaved }: { onSaved: () => void }) => (
    <div>
      <button type="button" onClick={onSaved}>
        Complete checkout
      </button>
    </div>
  ),
}));

const { MemberPurchasePage } = await import('./member-purchase-page');

const membership = {
  id: 'membership-id',
  account_id: 'account-id',
  contact_id: 'contact-id',
  member_number: 1007,
  user_id: 'user-id',
  plan_id: 'plan-id',
  start_date: '2026-08-15',
  end_date: '2026-09-15',
  status: 'active',
  fee_amount: 2000,
  fee_status: 'paid',
  created_at: '2026-08-15T00:00:00Z',
  updated_at: '2026-08-15T00:00:00Z',
  contact: {
    id: 'contact-id',
    user_id: 'user-id',
    account_id: 'account-id',
    name: 'Mira Shah',
    phone: '+91 90000 00000',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
  plan: {
    id: 'plan-id',
    account_id: 'account-id',
    name: 'Strength Monthly',
    price: 2000,
    duration_days: 30,
    plan_type: 'recurring',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  },
} as Membership;

beforeEach(() => {
  authState.accountRole = 'agent';
  authState.profileLoading = false;
  queryState.data = membership;
  queryState.error = null;
  routerPush.mockReset();
  membershipQuery.select.mockClear();
  membershipQuery.eq.mockClear();
  membershipQuery.maybeSingle.mockClear();
});

afterEach(cleanup);

describe('MemberPurchasePage', () => {
  it('shows compact member context above the catalogue and returns to the retained profile', async () => {
    render(
      <MemberPurchasePage
        membershipId="membership-id"
        returnTo="/members?branch=branch-id&view=all"
      />
    );

    expect(await screen.findByText('Mira Shah')).toBeTruthy();
    expect(screen.queryByText('+91 90000 00000')).toBeNull();
    expect(screen.getByText('1007')).toBeTruthy();
    expect(screen.getByText('Strength Monthly')).toBeTruthy();
    expect(screen.getByText('15 Sep 2026')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Member' }).className).toContain(
      'mb-4'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close add purchase' }));
    expect(routerPush).toHaveBeenCalledWith(
      '/members?branch=branch-id&view=all&member=membership-id'
    );
  });

  it('does not expose checkout when the membership identifier is missing', () => {
    render(<MemberPurchasePage membershipId={null} returnTo={null} />);

    expect(screen.getByText('Member not found')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Back to members' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Close add purchase' })
    ).toBeNull();
  });

  it('shows recovery when the requested member cannot be loaded', async () => {
    queryState.data = null;
    queryState.error = { message: 'Member unavailable' };

    render(<MemberPurchasePage membershipId="membership-id" returnTo={null} />);

    expect(await screen.findByText('Unable to load member')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Back to members' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Close add purchase' })
    ).toBeNull();
  });

  it('keeps viewer accounts out of checkout', async () => {
    authState.accountRole = 'viewer';

    render(<MemberPurchasePage membershipId="membership-id" returnTo={null} />);

    expect(await screen.findByText('Purchase access required')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Back to members' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Close add purchase' })
    ).toBeNull();
    await waitFor(() => expect(membershipQuery.select).not.toHaveBeenCalled());
  });
});
