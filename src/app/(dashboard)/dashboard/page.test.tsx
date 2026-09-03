import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  streamedSections: [] as string[],
  snapshots: [] as Promise<unknown>[],
  loadSnapshot: vi.fn(() => Promise.resolve({ errors: [] })),
}));

vi.mock('@/components/dashboard/dashboard-streaming', () => ({
  DashboardActionSectionStream: ({
    snapshot,
    section,
    children,
  }: {
    snapshot: Promise<unknown>;
    section: string;
    children: ReactNode;
  }) => {
    h.streamedSections.push(section);
    h.snapshots.push(snapshot);
    return <div data-stream={section}>{children}</div>;
  },
  loadDashboardActionSnapshotForRequest: h.loadSnapshot,
}));

vi.mock('@/components/dashboard/deferred-dashboard-insights', () => ({
  DeferredDashboardInsights: () => null,
}));
vi.mock('@/components/dashboard/deferred-activity-feed', () => ({
  DeferredActivityFeed: () => <div data-feed="recent-work" />,
}));
vi.mock('@/components/dashboard/dashboard-section', () => ({
  DashboardSection: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/dashboard/expiring-memberships', () => ({
  ExpiringMemberships: () => null,
}));
vi.mock('@/components/dashboard/follow-up-queue', () => ({
  FollowUpQueue: () => null,
}));
vi.mock('@/components/dashboard/gym-metrics', () => ({
  GymMetrics: () => null,
}));
vi.mock('@/components/dashboard/needs-attention-card', () => ({
  NeedsAttentionCard: () => null,
}));
vi.mock('@/components/dashboard/quick-actions', () => ({
  QuickActions: () => null,
}));
vi.mock('@/components/dashboard/uncontacted-leads', () => ({
  UncontactedLeads: () => null,
}));

const { default: DashboardPage } = await import('./page');

describe('DashboardPage first response', () => {
  it('returns the page shell synchronously and gives every data group an independent stream', () => {
    h.streamedSections.length = 0;
    h.snapshots.length = 0;
    h.loadSnapshot.mockClear();
    const result = DashboardPage();

    expect(result).not.toBeInstanceOf(Promise);
    const markup = renderToStaticMarkup(result);
    expect(h.streamedSections).toEqual([
      'gymMetrics',
      'followUps',
      'expiringMemberships',
      'uncontactedLeads',
      'attention',
    ]);
    expect(markup).toContain('data-stream="gymMetrics"');
    expect(markup).toContain('data-stream="attention"');
    // Recent work sits beside the uncontacted queue, so it renders from the
    // page rather than from the deferred insights below it.
    expect(markup).toContain('data-feed="recent-work"');
    expect(h.loadSnapshot).toHaveBeenCalledOnce();
    expect(new Set(h.snapshots).size).toBe(1);
  });
});
