// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: h.createClient,
}));
vi.mock('@/components/dashboard/conversations-chart', () => ({
  ConversationsChart: ({
    series,
    range,
    onRangeChange,
  }: {
    series: Record<number, Array<{ day: string }> | null>;
    range: number;
    onRangeChange: (range: 7) => void;
  }) => (
    <div>
      <output data-testid="conversation-data">
        {series[range]?.[0]?.day ?? 'empty'}
      </output>
      <button onClick={() => onRangeChange(7)}>Conversation 7 days</button>
    </div>
  ),
}));
vi.mock('@/components/dashboard/lead-conversion-rating', () => ({
  LeadConversionRating: ({
    data,
    onRangeChange,
  }: {
    data: { rangeDays: number } | null;
    onRangeChange: (range: 7) => void;
  }) => (
    <div>
      <output data-testid="rating-data">{data?.rangeDays ?? 'empty'}</output>
      <button onClick={() => onRangeChange(7)}>Rating 7 days</button>
    </div>
  ),
}));
vi.mock('@/components/dashboard/lead-funnel', () => ({
  LeadFunnel: ({ data }: { data: { totalLeads: number } | null }) => (
    <output data-testid="funnel-data">{data?.totalLeads ?? 'empty'}</output>
  ),
}));
vi.mock('@/components/dashboard/activity-feed', () => ({
  ActivityFeed: ({ items }: { items: Array<{ id: string }> | null }) => (
    <output data-testid="activity-data">{items?.[0]?.id ?? 'empty'}</output>
  ),
}));

import { DashboardInsights } from './dashboard-insights';

const initialPayload = {
  series: [{ day: '2026-08-27', incoming: 2, outgoing: 3 }],
  rating: { rangeDays: 30 },
  leadFunnel: { totalLeads: 4 },
  activity: [{ id: 'activity-1' }],
  errors: [],
};

describe('DashboardInsights consolidated request path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/dashboard/insights?view=initial') {
          return Response.json(initialPayload);
        }
        if (url === '/api/dashboard/insights?view=conversations&range=7') {
          return Response.json({
            series: [{ day: '2026-08-21', incoming: 1, outgoing: 1 }],
          });
        }
        if (url === '/api/dashboard/insights?view=lead-rating&range=7') {
          return Response.json({ rating: { rangeDays: 7 } });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates every initial insight from one no-store browser request', async () => {
    render(<DashboardInsights />);

    await waitFor(() => {
      expect(screen.getByTestId('conversation-data').textContent).toBe(
        '2026-08-27'
      );
    });
    expect(screen.getByTestId('rating-data').textContent).toBe('30');
    expect(screen.getByTestId('funnel-data').textContent).toBe('4');
    expect(screen.getByTestId('activity-data').textContent).toBe('activity-1');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/dashboard/insights?view=initial', {
      cache: 'no-store',
    });
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it('fetches uncached conversation and rating ranges through the API', async () => {
    render(<DashboardInsights />);
    await screen.findByText('2026-08-27');

    fireEvent.click(
      screen.getByRole('button', { name: 'Conversation 7 days' })
    );
    await screen.findByText('2026-08-21');
    fireEvent.click(screen.getByRole('button', { name: 'Rating 7 days' }));
    await waitFor(() => {
      expect(screen.getByTestId('rating-data').textContent).toBe('7');
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/dashboard/insights?view=conversations&range=7',
      { cache: 'no-store' }
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/dashboard/insights?view=lead-rating&range=7',
      { cache: 'no-store' }
    );
    expect(h.createClient).not.toHaveBeenCalled();
  });
});
