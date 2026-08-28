import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  streamedSections: [] as string[],
}));

vi.mock('@/components/dashboard/dashboard-streaming', () => ({
  DashboardActionSectionStream: ({
    section,
    children,
  }: {
    section: string;
    children: ReactNode;
  }) => {
    h.streamedSections.push(section);
    return <div data-stream={section}>{children}</div>;
  },
}));

vi.mock('@/components/dashboard/deferred-dashboard-insights', () => ({
  DeferredDashboardInsights: () => null,
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
  });
});
