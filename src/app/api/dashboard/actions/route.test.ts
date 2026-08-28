import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  loadDateContext: vi.fn(),
  loadSnapshot: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));
vi.mock('@/lib/dashboard/action-snapshot', () => ({
  loadDashboardActionDateContext: h.loadDateContext,
  loadDashboardActionSnapshot: h.loadSnapshot,
}));

import { GET } from './route';

const db = { branch: 'account-1' };
const dateContext = {
  timeZone: 'Asia/Kolkata',
  today: '2026-08-27',
};

describe('GET /api/dashboard/actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getCurrentAccount.mockResolvedValue({
      accountId: 'account-1',
      supabase: db,
      role: 'viewer',
    });
    h.loadDateContext.mockResolvedValue(dateContext);
    h.loadSnapshot.mockResolvedValue({
      today: '2026-08-27',
      gymMetrics: null,
      followUps: null,
      expiringMemberships: null,
      uncontactedLeads: null,
      attention: null,
      errors: [],
    });
  });

  it('returns one private no-store snapshot after viewer branch authorization', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0'
    );
    expect(h.getCurrentAccount).toHaveBeenCalledOnce();
    expect(h.loadDateContext).toHaveBeenCalledWith(db, 'account-1');
    expect(h.loadSnapshot).toHaveBeenCalledWith(db, dateContext);
    expect(h.getCurrentAccount.mock.invocationCallOrder[0]).toBeLessThan(
      h.loadDateContext.mock.invocationCallOrder[0]
    );
  });

  it('rejects an unauthorized caller before any dashboard action read', async () => {
    h.getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0'
    );
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(h.loadDateContext).not.toHaveBeenCalled();
    expect(h.loadSnapshot).not.toHaveBeenCalled();
  });

  it('does not publish a snapshot when branch locale resolution fails', async () => {
    h.loadDateContext.mockRejectedValue(
      new Error('Selected branch is unavailable')
    );

    const response = await GET();

    expect(response.status).toBe(403);
    expect(h.loadSnapshot).not.toHaveBeenCalled();
  });
});
