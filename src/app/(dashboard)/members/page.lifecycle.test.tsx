// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ListingView =
  | 'renewals'
  | 'followups'
  | 'trials'
  | 'payments'
  | 'retention'
  | 'all'
  | 'attendance';

const lifecycle = vi.hoisted(() => ({
  mounts: [] as ListingView[],
  unmounts: [] as ListingView[],
  requestsStarted: [] as ListingView[],
  requestsCompleted: [] as ListingView[],
  staleCompletionsIgnored: [] as ListingView[],
  pending: new Map<ListingView, () => void>(),
  realtimeSubscriptions: 0,
  realtimeRemovals: 0,
  realtimeHandlers: 0,
}));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');

  return {
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (notify) => {
          window.addEventListener('popstate', notify);
          window.addEventListener('testnavigation', notify);
          return () => {
            window.removeEventListener('popstate', notify);
            window.removeEventListener('testnavigation', notify);
          };
        },
        () => window.location.search,
        () => ''
      );
      return new URLSearchParams(search);
    },
  };
});

vi.mock('next/dynamic', async () => {
  const React = await import('react');
  const dynamicViews: ListingView[] = [
    'followups',
    'trials',
    'retention',
    'all',
    // MemberForm, ImportMembersCsvDialog, and MemberDetailView are unopened
    // in these listing lifecycle tests. Their placeholders are not listings.
    'renewals',
    'renewals',
    'renewals',
    'attendance',
    'payments',
  ];
  let importIndex = 0;

  return {
    default: () => {
      const view = dynamicViews[importIndex++];
      return function DynamicListingProbe() {
        React.useEffect(() => {
          let active = true;
          lifecycle.mounts.push(view);
          lifecycle.requestsStarted.push(view);
          lifecycle.pending.set(view, () => {
            if (active) lifecycle.requestsCompleted.push(view);
            else lifecycle.staleCompletionsIgnored.push(view);
          });
          return () => {
            active = false;
            lifecycle.unmounts.push(view);
          };
        }, []);
        return React.createElement('div', { 'data-testid': `view-${view}` });
      };
    },
  };
});

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ canSendMessages: true }),
}));

vi.mock('@/components/layout/page-header-actions', () => ({
  PageHeaderActions: ({ children }: { children: React.ReactNode }) => children,
  PageHeaderTabs: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/members/send-reminder-button', () => ({
  useReminderReadiness: () => ({
    loading: false,
    ready: true,
    reason: null,
    resolution: null,
    templateLanguage: 'en_US',
    templateName: 'gym_membership_renewal',
  }),
}));

vi.mock('@/components/members/renewal-action-lists', async () => {
  const React = await import('react');
  return {
    RenewalActionLists: function RenewalListingProbe() {
      React.useEffect(() => {
        let active = true;
        lifecycle.mounts.push('renewals');
        lifecycle.requestsStarted.push('renewals');
        lifecycle.pending.set('renewals', () => {
          if (active) lifecycle.requestsCompleted.push('renewals');
          else lifecycle.staleCompletionsIgnored.push('renewals');
        });
        return () => {
          active = false;
          lifecycle.unmounts.push('renewals');
        };
      }, []);
      return React.createElement('div', { 'data-testid': 'view-renewals' });
    },
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: vi.fn(() => {
        lifecycle.realtimeHandlers += 1;
        return channel;
      }),
      subscribe: vi.fn(() => {
        lifecycle.realtimeSubscriptions += 1;
        return channel;
      }),
    };
    return {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(() => {
        lifecycle.realtimeRemovals += 1;
      }),
    };
  },
}));

vi.mock('@/lib/memberships/lookup', () => ({
  membershipIdForContact: vi.fn(),
}));

const { default: MembersPage } = await import('./page');

const nativeReplaceState = window.history.replaceState.bind(window.history);

function resetLifecycle() {
  lifecycle.mounts.length = 0;
  lifecycle.unmounts.length = 0;
  lifecycle.requestsStarted.length = 0;
  lifecycle.requestsCompleted.length = 0;
  lifecycle.staleCompletionsIgnored.length = 0;
  lifecycle.pending.clear();
  lifecycle.realtimeSubscriptions = 0;
  lifecycle.realtimeRemovals = 0;
  lifecycle.realtimeHandlers = 0;
}

function setLocation(url: string) {
  nativeReplaceState({}, '', url);
}

async function complete(view: ListingView) {
  await act(async () => {
    lifecycle.pending.get(view)?.();
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetLifecycle();
  setLocation('/members');
  vi.spyOn(window.history, 'replaceState').mockImplementation(
    (state, unused, url) => {
      nativeReplaceState(state, unused, url);
      window.dispatchEvent(new Event('testnavigation'));
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Members listing URL lifecycle', () => {
  it.each([
    ['attendance', 'attendance'],
    ['payments', 'payments'],
    ['followups', 'followups'],
    ['all', 'all'],
    ['renewals', 'renewals'],
  ] as const)(
    'direct view=%s mounts and fetches only %s',
    async (queryView, mountedView) => {
      setLocation(`/members?branch=branch-a&view=${queryView}`);

      render(<MembersPage />);

      expect(screen.getByTestId(`view-${mountedView}`)).toBeTruthy();
      if (mountedView !== 'renewals') {
        expect(screen.queryByTestId('view-renewals')).toBeNull();
      }
      expect(lifecycle.mounts).toEqual([mountedView]);
      expect(lifecycle.requestsStarted).toEqual([mountedView]);
      expect(lifecycle.realtimeSubscriptions).toBe(1);
      expect(lifecycle.realtimeHandlers).toBe(4);

      await complete(mountedView);
      expect(lifecycle.requestsCompleted).toEqual([mountedView]);
      expect(lifecycle.staleCompletionsIgnored).toEqual([]);
    }
  );

  it.each(['/members', '/members?view=unknown'])(
    'uses the canonical Renewals fallback for %s',
    (url) => {
      setLocation(url);
      render(<MembersPage />);

      expect(screen.getByTestId('view-renewals')).toBeTruthy();
      expect(lifecycle.requestsStarted).toEqual(['renewals']);
    }
  );

  it('switches in-app without dropping branch/query state or duplicating Realtime', async () => {
    const user = userEvent.setup();
    setLocation('/members?branch=branch-a&view=attendance&source=dashboard');
    const page = render(<MembersPage />);

    await user.click(screen.getByRole('tab', { name: 'Payments' }));

    expect(screen.getByTestId('view-payments')).toBeTruthy();
    expect(window.location.search).toBe(
      '?branch=branch-a&view=payments&source=dashboard'
    );
    expect(lifecycle.mounts).toEqual(['attendance', 'payments']);
    expect(lifecycle.unmounts).toEqual(['attendance']);
    expect(lifecycle.requestsStarted).toEqual(['attendance', 'payments']);
    expect(lifecycle.realtimeSubscriptions).toBe(1);
    expect(lifecycle.realtimeHandlers).toBe(4);

    await complete('attendance');
    await complete('payments');
    expect(lifecycle.requestsCompleted).toEqual(['payments']);
    expect(lifecycle.staleCompletionsIgnored).toEqual(['attendance']);

    window.history.replaceState(
      {},
      '',
      '/members?branch=branch-a&view=payments&source=finance'
    );
    await waitFor(() => {
      expect(window.location.search).toContain('source=finance');
    });
    expect(lifecycle.requestsStarted).toEqual(['attendance', 'payments']);
    expect(lifecycle.realtimeSubscriptions).toBe(1);

    page.unmount();
    expect(lifecycle.realtimeRemovals).toBe(1);
  });

  it('tracks back and forward search-param entries without mounting Renewals', async () => {
    setLocation('/members?branch=branch-a&view=attendance');
    window.history.pushState(
      {},
      '',
      '/members?branch=branch-b&view=payments&source=finance'
    );
    render(<MembersPage />);

    act(() => window.history.back());
    await waitFor(() => {
      expect(screen.getByTestId('view-attendance')).toBeTruthy();
    });
    expect(window.location.search).toBe('?branch=branch-a&view=attendance');

    act(() => window.history.forward());
    await waitFor(() => {
      expect(screen.getByTestId('view-payments')).toBeTruthy();
    });
    expect(window.location.search).toBe(
      '?branch=branch-b&view=payments&source=finance'
    );
    expect(lifecycle.mounts).toEqual(['payments', 'attendance', 'payments']);
    expect(lifecycle.requestsStarted).not.toContain('renewals');
    expect(lifecycle.realtimeSubscriptions).toBe(1);
  });
});
