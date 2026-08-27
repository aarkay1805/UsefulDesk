import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  loadConversationsSeries: vi.fn(),
  loadLeadSourceRatings: vi.fn(),
  loadLeadFunnel: vi.fn(),
  loadActivity: vi.fn(),
}));

vi.mock('./queries', () => ({
  loadConversationsSeries: h.loadConversationsSeries,
  loadLeadFunnel: h.loadLeadFunnel,
  loadActivity: h.loadActivity,
}));
vi.mock('./lead-conversion-rating', () => ({
  loadLeadSourceRatings: h.loadLeadSourceRatings,
}));

import {
  DASHBOARD_ACTIVITY_PREVIEW_LIMIT,
  loadDashboardInsightsDateContext,
  loadDashboardInsightsSnapshot,
} from './insights-snapshot';

function localeDb(timezone: string) {
  const result = { data: { timezone }, error: null };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return {
    db: { from: vi.fn(() => builder) } as unknown as SupabaseClient,
    builder,
  };
}

describe('dashboard insights snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.loadConversationsSeries.mockResolvedValue([{ day: '2026-08-27' }]);
    h.loadLeadSourceRatings.mockResolvedValue({ rangeDays: 30 });
    h.loadLeadFunnel.mockResolvedValue({ stages: [] });
    h.loadActivity.mockResolvedValue([{ id: 'activity-1' }]);
  });

  it('derives today from the selected branch timezone', async () => {
    const { db, builder } = localeDb('America/New_York');

    const context = await loadDashboardInsightsDateContext(
      db,
      'account-1',
      new Date('2026-08-27T01:00:00.000Z')
    );

    expect(builder.eq).toHaveBeenCalledWith('id', 'account-1');
    expect(context).toEqual({
      timeZone: 'America/New_York',
      today: '2026-08-26',
    });
  });

  it('returns successful sections when one independent aggregate fails', async () => {
    const db = { branch: 'account-1' } as unknown as SupabaseClient;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.loadLeadSourceRatings.mockRejectedValue(new Error('rating unavailable'));

    const snapshot = await loadDashboardInsightsSnapshot(db, 30, {
      timeZone: 'Asia/Kolkata',
      today: '2026-08-27',
    });

    expect(snapshot.series).toEqual([{ day: '2026-08-27' }]);
    expect(snapshot.rating).toBeNull();
    expect(snapshot.leadFunnel).toEqual({ stages: [] });
    expect(snapshot.activity).toEqual([{ id: 'activity-1' }]);
    expect(snapshot.errors).toEqual(['leadRating']);
    expect(h.loadConversationsSeries).toHaveBeenCalledWith(
      db,
      30,
      'Asia/Kolkata',
      '2026-08-27'
    );
    expect(h.loadLeadSourceRatings).toHaveBeenCalledWith(
      db,
      30,
      'Asia/Kolkata',
      '2026-08-27'
    );
    expect(h.loadLeadFunnel).toHaveBeenCalledWith(
      db,
      'Asia/Kolkata',
      '2026-08-27'
    );
    expect(h.loadActivity).toHaveBeenCalledWith(
      db,
      DASHBOARD_ACTIVITY_PREVIEW_LIMIT
    );
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
