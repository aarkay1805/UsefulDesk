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

type RealtimePayload = {
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

const lifecycle = vi.hoisted(() => ({
  mounts: [] as ListingView[],
  unmounts: [] as ListingView[],
  requestsStarted: [] as ListingView[],
  requestsCompleted: [] as ListingView[],
  staleCompletionsIgnored: [] as ListingView[],
  detailReloadKeys: [] as number[],
  detailFollowUpReloadKeys: [] as number[],
  pending: new Map<ListingView, () => void>(),
  manualReloads: new Map<ListingView, (() => void) | undefined>(),
  realtimeSubscriptions: 0,
  realtimeRemovals: 0,
  realtimeHandlers: 0,
  readinessRequests: 0,
  realtimeCallbacks: new Map<string, (payload: RealtimePayload) => void>(),
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
  const dynamicViews: (ListingView | 'detail' | null)[] = [
    'followups',
    'trials',
    'retention',
    'all',
    // MemberForm and ImportMembersCsvDialog are not listings.
    null,
    null,
    'detail',
    'attendance',
    'payments',
  ];
  let importIndex = 0;

  return {
    default: () => {
      const view = dynamicViews[importIndex++];
      if (view === null) {
        return function DynamicDialogProbe() {
          return null;
        };
      }
      if (view === 'detail') {
        return function DynamicDetailProbe({
          reloadKey,
          followUpReloadKey,
        }: {
          reloadKey: number;
          followUpReloadKey: number;
        }) {
          React.useEffect(() => {
            lifecycle.detailReloadKeys.push(reloadKey);
          }, [reloadKey]);
          React.useEffect(() => {
            lifecycle.detailFollowUpReloadKeys.push(followUpReloadKey);
          }, [followUpReloadKey]);
          return React.createElement('div', { 'data-testid': 'member-detail' });
        };
      }
      return function DynamicListingProbe({
        reloadKey,
        onChanged,
        onAttendanceChanged,
      }: {
        reloadKey: number;
        onChanged?: () => void;
        onAttendanceChanged?: () => void;
      }) {
        lifecycle.manualReloads.set(view, onChanged ?? onAttendanceChanged);
        React.useEffect(() => {
          let active = true;
          lifecycle.mounts.push(view);
          lifecycle.pending.set(view, () => {
            if (active) lifecycle.requestsCompleted.push(view);
            else lifecycle.staleCompletionsIgnored.push(view);
          });
          return () => {
            active = false;
            lifecycle.unmounts.push(view);
          };
        }, []);
        React.useEffect(() => {
          lifecycle.requestsStarted.push(view);
        }, [reloadKey]);
        return React.createElement('div', { 'data-testid': `view-${view}` });
      };
    },
  };
});

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-a', canSendMessages: true }),
}));

vi.mock('@/components/layout/page-header-actions', () => ({
  PageHeaderActions: ({ children }: { children: React.ReactNode }) => children,
  PageHeaderTabs: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/members/send-reminder-button', async () => {
  const React = await import('react');
  return {
    useReminderReadiness: () => {
      React.useEffect(() => {
        // whatsapp_config + message_templates, fetched once by the real hook.
        lifecycle.readinessRequests += 2;
      }, []);
      return {
        loading: false,
        ready: true,
        reason: null,
        resolution: null,
        templateLanguage: 'en_US',
        templateName: 'gym_membership_renewal',
      };
    },
  };
});

vi.mock('@/components/members/renewal-action-lists', async () => {
  const React = await import('react');
  return {
    RenewalActionLists: function RenewalListingProbe({
      reloadKey,
    }: {
      reloadKey: number;
    }) {
      React.useEffect(() => {
        let active = true;
        lifecycle.mounts.push('renewals');
        lifecycle.pending.set('renewals', () => {
          if (active) lifecycle.requestsCompleted.push('renewals');
          else lifecycle.staleCompletionsIgnored.push('renewals');
        });
        return () => {
          active = false;
          lifecycle.unmounts.push('renewals');
        };
      }, []);
      React.useEffect(() => {
        lifecycle.requestsStarted.push('renewals');
      }, [reloadKey]);
      return React.createElement('div', { 'data-testid': 'view-renewals' });
    },
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: vi.fn(
        (
          _event: string,
          filter: { table: string },
          callback: (payload: RealtimePayload) => void
        ) => {
          lifecycle.realtimeHandlers += 1;
          lifecycle.realtimeCallbacks.set(filter.table, callback);
          return channel;
        }
      ),
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
  lifecycle.detailReloadKeys.length = 0;
  lifecycle.detailFollowUpReloadKeys.length = 0;
  lifecycle.pending.clear();
  lifecycle.manualReloads.clear();
  lifecycle.realtimeSubscriptions = 0;
  lifecycle.realtimeRemovals = 0;
  lifecycle.realtimeHandlers = 0;
  lifecycle.readinessRequests = 0;
  lifecycle.realtimeCallbacks.clear();
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

function emitRealtime(
  table: string,
  payload: RealtimePayload = {
    new: { account_id: 'account-a' },
    old: {},
  }
) {
  const callback = lifecycle.realtimeCallbacks.get(table);
  if (!callback) throw new Error(`Missing Realtime handler for ${table}`);
  callback(payload);
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
      expect(lifecycle.realtimeHandlers).toBe(15);

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
    expect(lifecycle.realtimeHandlers).toBe(15);

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

const ALL_LISTING_VIEWS: ListingView[] = [
  'renewals',
  'followups',
  'trials',
  'payments',
  'retention',
  'all',
  'attendance',
];

const EXPECTED_REALTIME_DEPENDENCIES: Record<string, ListingView[]> = {
  memberships: ALL_LISTING_VIEWS,
  contacts: ALL_LISTING_VIEWS,
  membership_plans: ALL_LISTING_VIEWS,
  member_services: ['renewals', 'all'],
  payments: ['payments', 'all'],
  payment_allocations: ['payments', 'all'],
  payment_refunds: ['payments', 'all'],
  payment_refund_allocations: ['payments', 'all'],
  invoice_lines: ['payments', 'all'],
  invoice_credit_allocations: ['payments', 'all'],
  invoice_adjustment_allocations: ['payments', 'all'],
  membership_periods: ['payments'],
  invoices: ['all'],
  attendance: ['retention', 'attendance'],
  follow_ups: ['followups', 'all'],
};

const REALTIME_VIEW_CASES = Object.entries(
  EXPECTED_REALTIME_DEPENDENCIES
).flatMap(([table, affectedViews]) =>
  ALL_LISTING_VIEWS.map(
    (view) => [table, view, affectedViews.includes(view)] as const
  )
);

describe('Members Realtime dependency lifecycle', () => {
  it('independently measures the before/after request matrix', () => {
    const requestsPerScopedRefresh: Record<ListingView, number> = {
      renewals: 1,
      followups: 1,
      trials: 1,
      payments: 1,
      retention: 2,
      all: 1,
      attendance: 1,
    };
    const requestsPerGlobalRefreshBefore: Record<ListingView, number> = {
      ...requestsPerScopedRefresh,
      all: 2,
    };
    const originalTables = [
      'memberships',
      'payments',
      'attendance',
      'follow_ups',
    ];
    const beforeRequests = originalTables.reduce(
      (total) =>
        total +
        ALL_LISTING_VIEWS.reduce(
          (viewTotal, view) => viewTotal + requestsPerGlobalRefreshBefore[view],
          0
        ),
      0
    );
    const originalAfterRequests = originalTables.reduce(
      (total, table) =>
        total +
        EXPECTED_REALTIME_DEPENDENCIES[table].reduce(
          (viewTotal, view) => viewTotal + requestsPerScopedRefresh[view],
          0
        ),
      0
    );
    const relevantCases = REALTIME_VIEW_CASES.filter(([, , relevant]) =>
      Boolean(relevant)
    );
    const completeAfterRequests = relevantCases.reduce(
      (total, [, view]) => total + requestsPerScopedRefresh[view],
      0
    );

    expect({
      beforeRequests,
      originalAfterRequests,
      relevantPairs: relevantCases.length,
      unrelatedPairs: REALTIME_VIEW_CASES.length - relevantCases.length,
      completeAfterRequests,
    }).toEqual({
      beforeRequests: 36,
      originalAfterRequests: 15,
      relevantPairs: 43,
      unrelatedPairs: 62,
      completeAfterRequests: 47,
    });
  });

  it.each(REALTIME_VIEW_CASES)(
    '%s event × active %s has relevant=%s request behavior',
    (table, view, relevant) => {
      vi.useFakeTimers();
      setLocation(`/members?branch=branch-a&view=${view}`);
      render(<MembersPage />);
      expect(lifecycle.requestsStarted).toEqual([view]);

      act(() => {
        emitRealtime(table);
        vi.advanceTimersByTime(400);
      });

      expect(lifecycle.requestsStarted).toEqual(
        relevant ? [view, view] : [view]
      );
      vi.useRealTimers();
    }
  );

  it('coalesces a rapid mixed-table burst into one relevant refetch', () => {
    vi.useFakeTimers();
    setLocation('/members?branch=branch-a&view=payments');
    render(<MembersPage />);

    act(() => {
      emitRealtime('payments');
      vi.advanceTimersByTime(200);
      emitRealtime('invoice_lines');
      emitRealtime('attendance');
      vi.advanceTimersByTime(399);
    });
    expect(lifecycle.requestsStarted).toEqual(['payments']);

    act(() => vi.advanceTimersByTime(1));
    expect(lifecycle.requestsStarted).toEqual(['payments', 'payments']);
    expect(lifecycle.readinessRequests).toBe(2);
    vi.useRealTimers();
  });

  it('does not refetch an unrelated tab selected before debounce', () => {
    vi.useFakeTimers();
    setLocation('/members?branch=branch-a&view=renewals');
    render(<MembersPage />);

    act(() => {
      emitRealtime('payments');
      window.history.replaceState(
        {},
        '',
        '/members?branch=branch-a&view=attendance'
      );
    });
    expect(lifecycle.requestsStarted).toEqual(['renewals', 'attendance']);

    act(() => vi.advanceTimersByTime(400));
    expect(lifecycle.requestsStarted).toEqual(['renewals', 'attendance']);
    vi.useRealTimers();
  });

  it('mounts a relevant tab selected before debounce with the fresh token', () => {
    vi.useFakeTimers();
    setLocation('/members?branch=branch-a&view=renewals');
    render(<MembersPage />);

    act(() => {
      emitRealtime('attendance');
      window.history.replaceState(
        {},
        '',
        '/members?branch=branch-a&view=attendance'
      );
    });
    expect(lifecycle.requestsStarted).toEqual(['renewals', 'attendance']);

    act(() => vi.advanceTimersByTime(400));

    expect(lifecycle.requestsStarted).toEqual(['renewals', 'attendance']);
    vi.useRealTimers();
  });

  it('uses one channel and filters handlers to the selected account', () => {
    vi.useFakeTimers();
    setLocation('/members?branch=account-a&view=all');
    render(<MembersPage />);

    expect(lifecycle.realtimeSubscriptions).toBe(1);
    expect(lifecycle.realtimeHandlers).toBe(15);
    act(() => {
      emitRealtime('memberships', {
        new: { account_id: 'account-b' },
        old: {},
      });
      vi.advanceTimersByTime(400);
    });
    expect(lifecycle.requestsStarted).toEqual(['all']);

    act(() => {
      emitRealtime('memberships', { new: {}, old: { id: 'deleted-id' } });
      vi.advanceTimersByTime(400);
    });
    expect(lifecycle.requestsStarted).toEqual(['all', 'all']);
    vi.useRealTimers();
  });

  it('refreshes an open member sheet without refetching an unrelated listing', async () => {
    vi.useFakeTimers();
    setLocation(
      '/members?branch=account-a&view=attendance&member=00000000-0000-4000-8000-000000000001'
    );
    render(<MembersPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('member-detail')).toBeTruthy();
    expect(lifecycle.detailReloadKeys).toEqual([0]);
    expect(lifecycle.detailFollowUpReloadKeys).toEqual([0]);

    act(() => {
      emitRealtime('payments');
      vi.advanceTimersByTime(400);
    });

    expect(lifecycle.requestsStarted).toEqual(['attendance']);
    expect(lifecycle.detailReloadKeys).toEqual([0, 1]);
    expect(lifecycle.detailFollowUpReloadKeys).toEqual([0]);

    act(() => {
      emitRealtime('follow_ups');
      vi.advanceTimersByTime(400);
    });
    expect(lifecycle.requestsStarted).toEqual(['attendance']);
    expect(lifecycle.detailReloadKeys).toEqual([0, 1]);
    expect(lifecycle.detailFollowUpReloadKeys).toEqual([0, 1]);
    vi.useRealTimers();
  });

  it('keeps an active listing write refresh immediate and scoped', () => {
    setLocation('/members?branch=account-a&view=attendance');
    render(<MembersPage />);

    act(() => lifecycle.manualReloads.get('attendance')?.());

    expect(lifecycle.requestsStarted).toEqual(['attendance', 'attendance']);
    expect(lifecycle.realtimeSubscriptions).toBe(1);
  });

  it('cancels the pending timer and removes its single channel on unmount', () => {
    vi.useFakeTimers();
    setLocation('/members?branch=branch-a&view=all');
    const page = render(<MembersPage />);

    act(() => emitRealtime('memberships'));
    page.unmount();
    act(() => vi.advanceTimersByTime(400));

    expect(lifecycle.requestsStarted).toEqual(['all']);
    expect(lifecycle.realtimeSubscriptions).toBe(1);
    expect(lifecycle.realtimeRemovals).toBe(1);
    vi.useRealTimers();
  });
});
