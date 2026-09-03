// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  play: vi.fn(),
  removeChannel: vi.fn(),
  handlers: [] as Array<{
    config: Record<string, unknown>;
    callback: (payload: Record<string, unknown>) => void;
  }>,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: h.accountId }),
}));
vi.mock('@/lib/notifications/notification-sounds', () => ({
  playInboxMessageTone: h.play,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [{ id: 'conversation-1', unread_count: 1 }],
          error: null,
        }),
      }),
    }),
    channel: () => {
      const channel = {
        on: (
          _kind: string,
          config: Record<string, unknown>,
          callback: (payload: Record<string, unknown>) => void
        ) => {
          h.handlers.push({ config, callback });
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: h.removeChannel,
  }),
}));

import { useTotalUnread } from './use-total-unread';

describe('useTotalUnread message sound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.accountId = 'account-a';
    h.handlers = [];
  });

  it('filters message inserts and chimes only for this account customer', async () => {
    const { result } = renderHook(() => useTotalUnread({ sound: true }));
    await waitFor(() => expect(result.current).toBe(1));
    const message = h.handlers.find(
      ({ config }) => config.table === 'messages'
    )!;
    expect(message.config).toMatchObject({
      event: 'INSERT',
      table: 'messages',
    });

    act(() =>
      message.callback({
        new: {
          conversation_id: 'conversation-1',
          sender_type: 'customer',
        },
      })
    );
    act(() =>
      message.callback({
        new: { account_id: 'account-b', sender_type: 'customer' },
      })
    );
    act(() =>
      message.callback({
        new: { conversation_id: 'conversation-1', sender_type: 'agent' },
      })
    );

    expect(h.play).toHaveBeenCalledTimes(1);
  });

  it('swallows audio failure at the realtime boundary', () => {
    renderHook(() => useTotalUnread({ sound: true }));
    const message = h.handlers.find(
      ({ config }) => config.table === 'messages'
    )!;
    h.play.mockImplementationOnce(() => {
      throw new Error('audio device failed');
    });

    expect(() =>
      act(() =>
        message.callback({
          new: { account_id: 'account-a', sender_type: 'customer' },
        })
      )
    ).not.toThrow();
  });
});
