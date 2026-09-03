// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  eq: vi.fn(),
  removeChannel: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  subscriptions: [] as Array<{
    config: Record<string, unknown>;
    callback: (payload: Record<string, unknown>) => void;
    channel: object;
  }>,
}));

vi.mock('@/lib/notifications/notification-sounds', () => ({
  playFollowUpReminderTone: h.play,
  stopFollowUpReminderTone: h.stop,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const query = {
          eq: (field: string, value: string) => {
            h.eq(field, value);
            return query;
          },
          is: () => query,
          gte: async () => ({ data: h.rows, error: null }),
        };
        return query;
      },
    }),
    channel: () => {
      const channel = {
        on: (
          _kind: string,
          config: Record<string, unknown>,
          callback: (payload: Record<string, unknown>) => void
        ) => {
          h.subscriptions.push({ config, callback, channel });
          return channel;
        },
        subscribe: (callback: (status: string) => void) => {
          callback('SUBSCRIBED');
          return channel;
        },
      };
      return channel;
    },
    removeChannel: h.removeChannel,
  }),
}));

import { useFollowUpReminderRingtone } from './use-follow-up-reminder-ringtone';

describe('useFollowUpReminderRingtone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rows = [];
    h.subscriptions = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('scopes hydration and Realtime to the active account', async () => {
    renderHook(() => useFollowUpReminderRingtone('account-a'));
    await act(async () => Promise.resolve());

    expect(h.eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(h.subscriptions[0].config).toMatchObject({
      table: 'notifications',
      filter: 'account_id=eq.account-a',
    });
  });

  it('ignores mismatched rows and fully resets on branch change', async () => {
    const view = renderHook(
      ({ accountId }) => useFollowUpReminderRingtone(accountId),
      { initialProps: { accountId: 'account-a' as string | null } }
    );
    await act(async () => Promise.resolve());
    act(() =>
      h.subscriptions[0].callback({
        eventType: 'INSERT',
        new: {
          id: 'notification-1',
          account_id: 'account-b',
          type: 'follow_up_reminder',
          read_at: null,
          created_at: '2026-09-03T12:00:00.000Z',
        },
        old: {},
      })
    );
    expect(h.play).not.toHaveBeenCalled();

    view.rerender({ accountId: 'account-b' });
    await act(async () => Promise.resolve());

    expect(h.removeChannel).toHaveBeenCalledTimes(1);
    expect(h.stop).toHaveBeenCalled();
    expect(h.subscriptions[1].config).toMatchObject({
      filter: 'account_id=eq.account-b',
    });
  });

  it('stops when an active reminder is read or deleted', async () => {
    renderHook(() => useFollowUpReminderRingtone('account-a'));
    await act(async () => Promise.resolve());
    const callback = h.subscriptions[0].callback;
    const row = {
      id: 'notification-1',
      account_id: 'account-a',
      type: 'follow_up_reminder',
      read_at: null,
      created_at: '2026-09-03T12:00:00.000Z',
    };
    act(() => callback({ eventType: 'INSERT', new: row, old: {} }));
    expect(h.play).toHaveBeenCalled();

    act(() =>
      callback({
        eventType: 'UPDATE',
        new: { ...row, read_at: '2026-09-03T12:01:00.000Z' },
        old: row,
      })
    );
    const stopsAfterRead = h.stop.mock.calls.length;
    act(() =>
      callback({
        eventType: 'DELETE',
        new: {},
        old: { id: row.id, account_id: 'account-a' },
      })
    );

    expect(h.stop.mock.calls.length).toBeGreaterThan(stopsAfterRead);
  });
});
