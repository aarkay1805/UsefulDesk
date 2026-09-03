import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  loadDateContext: vi.fn(),
  loadSnapshot: vi.fn(),
  loadConversationsSeries: vi.fn(),
  loadLeadSourceRatings: vi.fn(),
  loadActivity: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));
vi.mock('@/lib/dashboard/insights-snapshot', () => ({
  loadDashboardActivity: h.loadActivity,
  loadDashboardInsightsDateContext: h.loadDateContext,
  loadDashboardInsightsSnapshot: h.loadSnapshot,
}));
vi.mock('@/lib/dashboard/queries', () => ({
  loadConversationsSeries: h.loadConversationsSeries,
}));
vi.mock('@/lib/dashboard/lead-conversion-rating', () => ({
  loadLeadSourceRatings: h.loadLeadSourceRatings,
}));

import { GET } from './route';

const db = { branch: 'account-1' };
const dateContext = {
  timeZone: 'Asia/Kolkata',
  today: '2026-08-27',
  phoneCountryCode: '+91',
};

describe('GET /api/dashboard/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getCurrentAccount.mockResolvedValue({
      accountId: 'account-1',
      supabase: db,
      role: 'viewer',
    });
    h.loadDateContext.mockResolvedValue(dateContext);
    h.loadSnapshot.mockResolvedValue({
      series: [],
      rating: null,
      leadFunnel: { stages: [] },
      errors: ['leadRating'],
    });
    h.loadConversationsSeries.mockResolvedValue([{ day: '2026-08-27' }]);
    h.loadLeadSourceRatings.mockResolvedValue({ rangeDays: 7 });
    h.loadActivity.mockResolvedValue([{ id: 'activity-1' }]);
  });

  it('returns one no-store initial snapshot after branch authorization', async () => {
    const response = await GET(
      new Request('https://usefuldesk.test/api/dashboard/insights?view=initial')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0'
    );
    expect(await response.json()).toEqual({
      series: [],
      rating: null,
      leadFunnel: { stages: [] },
      errors: ['leadRating'],
    });
    expect(h.getCurrentAccount).toHaveBeenCalledOnce();
    expect(h.loadDateContext).toHaveBeenCalledWith(db, 'account-1');
    expect(h.loadSnapshot).toHaveBeenCalledWith(db, 30, dateContext);
    expect(h.getCurrentAccount.mock.invocationCallOrder[0]).toBeLessThan(
      h.loadDateContext.mock.invocationCallOrder[0]
    );
  });

  it('keeps conversation and rating range refreshes on the same server boundary', async () => {
    const conversationResponse = await GET(
      new Request(
        'https://usefuldesk.test/api/dashboard/insights?view=conversations&range=90'
      )
    );
    const ratingResponse = await GET(
      new Request(
        'https://usefuldesk.test/api/dashboard/insights?view=lead-rating&range=7'
      )
    );

    expect(await conversationResponse.json()).toEqual({
      series: [{ day: '2026-08-27' }],
    });
    expect(await ratingResponse.json()).toEqual({ rating: { rangeDays: 7 } });
    expect(h.loadConversationsSeries).toHaveBeenCalledWith(
      db,
      90,
      'Asia/Kolkata',
      '2026-08-27'
    );
    expect(h.loadLeadSourceRatings).toHaveBeenCalledWith(
      db,
      7,
      'Asia/Kolkata',
      '2026-08-27'
    );
  });

  it('serves recent work on its own range-free view', async () => {
    const response = await GET(
      new Request(
        'https://usefuldesk.test/api/dashboard/insights?view=activity'
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activity: [{ id: 'activity-1' }] });
    expect(h.loadActivity).toHaveBeenCalledWith(db, dateContext);
    expect(h.loadSnapshot).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized caller before any dashboard data read', async () => {
    h.getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));

    const response = await GET(
      new Request('https://usefuldesk.test/api/dashboard/insights?view=initial')
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0'
    );
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(h.loadDateContext).not.toHaveBeenCalled();
    expect(h.loadSnapshot).not.toHaveBeenCalled();
  });

  it('rejects unsupported ranges without starting a data read', async () => {
    const response = await GET(
      new Request(
        'https://usefuldesk.test/api/dashboard/insights?view=conversations&range=365'
      )
    );

    expect(response.status).toBe(400);
    expect(h.getCurrentAccount).not.toHaveBeenCalled();
  });
});
