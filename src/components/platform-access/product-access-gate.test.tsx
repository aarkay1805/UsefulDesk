// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
const openTestCheckout = vi.hoisted(() => vi.fn());
vi.mock('@/lib/subscriptions/test-checkout-client', () => ({
  openUsefulDeskTestCheckout: openTestCheckout,
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const auth = vi.hoisted(() => ({
  accountId: 'branch-1',
  organizationId: 'org-1',
  accountStatus: 'ready',
  branches: [] as Array<{
    account_id: string;
    account_name: string;
    organization_id: string;
    organization_name: string;
    branch_status: 'active' | 'read_only' | 'archived';
  }>,
  isOrganizationOwner: false,
  switchBranch: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      dateTime: (value: string) => value,
      money: (value: number) => `₹${value}`,
    },
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
import { ProductAccessGate } from './product-access-gate';
import type { ProductAccessSnapshot } from '@/lib/platform-access/model';
import { useEffect } from 'react';
const access = {
  organization_id: 'org-1',
  mode: 'trial' as const,
  trial_started_at: '2026-09-01T00:00:00Z',
  trial_ends_at: '2026-09-15T00:00:00Z',
  access_starts_at: null,
  access_ends_at: null,
  suspended_at: null,
  version: 1,
};
const snapshot = {
  access,
  allowed: true,
  status: 'trial',
  enforcement_enabled: true,
  support_email: null,
  support_whatsapp: '919056208861',
} satisfies ProductAccessSnapshot;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  auth.accountId = 'branch-1';
  auth.organizationId = 'org-1';
  auth.isOrganizationOwner = false;
  auth.branches = [];
  openTestCheckout.mockReset();
  rpc.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-06T00:00:00Z'));
});
describe('ProductAccessGate', () => {
  it('offers owner-only Test checkout after expiry when the local flag is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_TEST_BILLING_UI', 'true');
    auth.isOrganizationOwner = true;
    auth.branches = [
      {
        account_id: 'branch-1',
        account_name: 'Central',
        organization_id: 'org-1',
        organization_name: 'Gym',
        branch_status: 'active',
      },
    ];
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('monthly-intents')
              ? { intent: { state: 'pending', request_id: 'resumed-request' } }
              : {
                  checkout: {
                    keyId: 'rzp_test_key',
                    orderId: 'order_Test123',
                    amountMinor: 149900,
                  },
                }
          ),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    openTestCheckout.mockResolvedValue(undefined);
    rpc.mockResolvedValue({
      data: [
        {
          account_id: 'branch-1',
          account_name: 'Central',
          organization_id: 'org-1',
          branch_status: 'active',
        },
      ],
      error: null,
    });
    render(
      <ProductAccessGate
        initialAccess={{
          accountId: 'branch-1',
          organizationId: 'org-1',
          snapshot: {
            ...snapshot,
            allowed: false,
            status: 'expired',
            access: { ...access, trial_ends_at: '2026-09-05T00:00:00Z' },
          },
        }}
      >
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('subscription_conversion_branches', {
        p_organization_id: 'org-1',
      })
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Choose Growth' }));
    await waitFor(() => expect(openTestCheckout).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        String(
          (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body
        )
      ).requestId
    ).toBe('resumed-request');
    expect(openTestCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order_Test123',
        amountMinor: 149900,
      })
    );
  });
  it('uses a server-validated snapshot on cold entry before background revalidation', async () => {
    render(
      <ProductAccessGate
        initialAccess={{
          accountId: 'branch-1',
          organizationId: 'org-1',
          snapshot,
        }}
      >
        <div>Operations</div>
      </ProductAccessGate>
    );

    expect(screen.getByText('Operations')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading UsefulDesk' })
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: snapshot, error: null });
    fireEvent.focus(window);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  });
  it('lets a trial user compare all three plans without selecting a tier', async () => {
    render(
      <ProductAccessGate
        initialAccess={{
          accountId: 'branch-1',
          organizationId: 'org-1',
          snapshot,
        }}
      >
        <div>Operations</div>
      </ProductAccessGate>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare plans' }));
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Growth')).toBeTruthy();
    expect(screen.getByText('Ultimate')).toBeTruthy();
    expect(
      screen.getByText(/Your trial includes features from every plan/)
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /pay|buy|subscribe/i })
    ).toBeNull();
    expect(screen.queryByText('₹799')).toBeNull();
  });
  it('does not reuse the server snapshot for a different branch', async () => {
    auth.accountId = 'branch-2';
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Access check unavailable' },
    });
    render(
      <ProductAccessGate
        initialAccess={{
          accountId: 'branch-1',
          organizationId: 'org-1',
          snapshot,
        }}
      >
        <div>Operations</div>
      </ProductAccessGate>
    );

    expect(screen.queryByText('Operations')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Access check unavailable')).toBeTruthy()
    );
  });
  it('does not reuse the server snapshot for a different organization', async () => {
    auth.organizationId = 'org-2';
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Access check unavailable' },
    });
    render(
      <ProductAccessGate
        initialAccess={{
          accountId: 'branch-1',
          organizationId: 'org-1',
          snapshot,
        }}
      >
        <div>Operations</div>
      </ProductAccessGate>
    );

    expect(screen.queryByText('Operations')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Access check unavailable')).toBeTruthy()
    );
  });
  it('shows only a spinner until access is confirmed, then mounts operational children', async () => {
    let finish: (value: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    expect(screen.queryByText('Operations')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Loading UsefulDesk' })
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await act(async () => {
      finish({ data: snapshot, error: null });
    });
    expect(screen.getByText('Operations')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading UsefulDesk' })
    ).toBeNull();
  });
  it('mounts active trial and closes at its exact deadline before a refresh finishes', async () => {
    vi.useFakeTimers();
    const start = Date.parse('2026-09-06T00:00:00Z');
    rpc.mockResolvedValueOnce({
      data: {
        ...snapshot,
        access: {
          ...access,
          trial_ends_at: new Date(start + 1000).toISOString(),
        },
      },
      error: null,
    });
    await act(async () => {
      render(
        <ProductAccessGate>
          <div>Operations</div>
        </ProductAccessGate>
      );
    });
    expect(screen.getByText('Operations')).toBeTruthy();
    rpc.mockReturnValue(new Promise(() => {}));
    vi.spyOn(Date, 'now').mockReturnValue(start + 1000);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Operations')).toBeNull();
    expect(screen.getByText('Contact support')).toBeTruthy();
  });
  it('retains support and sign-out while expired and refreshes on focus', async () => {
    rpc.mockResolvedValue({
      data: {
        ...snapshot,
        allowed: false,
        access: { ...access, trial_ends_at: '2026-09-05T00:00:00Z' },
      },
      error: null,
    });
    render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() =>
      expect(screen.getByText('WhatsApp support')).toBeTruthy()
    );
    expect(screen.queryByText('Operations')).toBeNull();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    rpc.mockResolvedValue({ data: snapshot, error: null });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
  it('fails closed after RPC error and never reuses another branch access', async () => {
    rpc.mockResolvedValueOnce({ data: snapshot, error: null });
    const view = render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    auth.accountId = 'branch-2';
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Access check unavailable' },
    });
    view.rerender(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    expect(screen.queryByText('Operations')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Access check unavailable')).toBeTruthy()
    );
  });
  it('keeps operational children mounted throughout a routine refresh', async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Operations() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <div>Operations</div>;
    }
    rpc.mockResolvedValue({ data: snapshot, error: null });
    render(
      <ProductAccessGate>
        <Operations />
      </ProductAccessGate>
    );
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    let finish: (value: unknown) => void = () => {};
    rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.focus(window);
    expect(screen.getByText('Operations')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    await act(async () => {
      finish({ data: snapshot, error: null });
    });
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    const link = screen.getByRole('link', { name: 'Contact support' });
    expect(
      new URL(link.getAttribute('href')!).searchParams.get('text')
    ).toContain('Support reference: org-1');
  });
  it.each([
    {},
    { ...snapshot, enforcement_enabled: undefined },
    { ...snapshot, enforcement_enabled: 'false' },
    { ...snapshot, allowed: false, enforcement_enabled: false },
    { ...snapshot, allowed: 'true', enforcement_enabled: false },
    { ...snapshot, access: { ...access, organization_id: 'another-org' } },
    { ...snapshot, access: null, enforcement_enabled: false },
  ])(
    'never mounts operational content for a malformed, denied, or wrong-organization grant: %j',
    async (payload) => {
      rpc.mockResolvedValue({ data: payload, error: null });
      render(
        <ProductAccessGate>
          <div>Operations</div>
        </ProductAccessGate>
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('status', { name: 'Loading UsefulDesk' })
        ).toBeNull()
      );
      expect(screen.queryByText('Operations')).toBeNull();
    }
  );
  it('allows a valid explicitly granted rollout-disabled snapshot', async () => {
    rpc.mockResolvedValue({
      data: { ...snapshot, allowed: true, enforcement_enabled: false },
      error: null,
    });
    render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
  });
});

describe('Live billing access after the initial term', () => {
  function renderPaid(expired: boolean, owner = true) {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_LIVE_REVIEW_UI', 'true');
    auth.isOrganizationOwner = owner;
    const paid: ProductAccessSnapshot = {
      ...snapshot,
      allowed: !expired,
      status: expired ? 'expired' : 'active',
      access: {
        ...access,
        mode: 'manual',
        access_starts_at: '2026-08-01T00:00:00Z',
        access_ends_at: expired
          ? '2026-09-01T00:00:00Z'
          : '2026-10-01T00:00:00Z',
      },
    };
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_quote'
          ? null
          : name === 'subscription_live_owner_term'
            ? {
                request_id: 'paid-term',
                tier: 'starter',
                paid_through_end: paid.access.access_ends_at,
                expired,
                refunded: false,
                renewal_stopped: false,
              }
            : paid,
      error: null,
    }));
    render(
      <ProductAccessGate
        initialAccess={{
          accountId: auth.accountId,
          organizationId: auth.organizationId,
          snapshot: paid,
        }}
      >
        Gym content
      </ProductAccessGate>
    );
  }
  it('keeps the owner renewal review reachable after manual paid access expires', async () => {
    renderPaid(true);
    expect(
      await screen.findByRole('button', { name: 'Review renewal amount' })
    ).toBeTruthy();
    expect(screen.queryByText('Gym content')).toBeNull();
  });
  it('opens the same paid owner panel for cancellation before expiry', async () => {
    renderPaid(false);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open billing' })
    );
    expect(
      await screen.findByRole('button', { name: 'Cancel renewal' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Review renewal amount' })
    ).toBeNull();
  });
  it('does not expose owner renewal controls to staff', async () => {
    renderPaid(true, false);
    await screen.findByText('Contact support');
    expect(
      screen.queryByRole('button', { name: 'Review renewal amount' })
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith(
      'subscription_live_owner_term',
      expect.anything()
    );
  });
});
