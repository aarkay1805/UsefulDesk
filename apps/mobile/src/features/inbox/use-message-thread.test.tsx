import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ConversationRepository } from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type {
  InboxConnectionState,
  InboxRealtimeEvent,
} from './inbox-realtime';
import {
  ABSENT_MESSAGE_ID,
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_0_ID,
  MESSAGE_1_ID,
  MESSAGE_2_ID,
  MESSAGE_3_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
  conversation,
  message,
  page,
} from './inbox-test-fixtures';
import type { MessageRepository } from './message-repository';
import type {
  InboxConversation,
  InboxMessage,
  MessageCursor,
  Page,
} from './inbox-types';
import {
  type UseMessageThreadOptions,
  type UseMessageThreadResult,
  useMessageThread,
} from './use-message-thread';

type MessagePage = Page<InboxMessage, MessageCursor>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const conversations: jest.Mocked<ConversationRepository> = {
  list: jest.fn(),
  unreadCount: jest.fn(),
  get: jest.fn().mockResolvedValue(conversation()),
  markRead: jest.fn().mockResolvedValue(undefined),
};
const messages: jest.Mocked<MessageRepository> = {
  get: jest.fn().mockResolvedValue(message()),
  list: jest
    .fn()
    .mockResolvedValue(
      page([
        message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
        message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
      ])
    ),
};

function fakeThreadRealtimeFeed(): InboxRealtimeFeed & {
  eventCleanup: jest.Mock;
  statusCleanup: jest.Mock;
  emit(event: InboxRealtimeEvent): Promise<void>;
  emitStatus(
    connection: InboxConnectionState,
    generation: number
  ): Promise<void>;
} {
  const events = new Set<(event: InboxRealtimeEvent) => void>();
  const statuses = new Set<
    (snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']>) => void
  >();
  let snapshot: ReturnType<InboxRealtimeFeed['getSnapshot']> = {
    connection: 'connected',
    resyncGeneration: 0,
  };
  const eventCleanup = jest.fn();
  const statusCleanup = jest.fn();
  return {
    eventCleanup,
    statusCleanup,
    getSnapshot: () => snapshot,
    listen(listener) {
      events.add(listener);
      return () => {
        events.delete(listener);
        eventCleanup();
      };
    },
    listenStatus(listener) {
      statuses.add(listener);
      return () => {
        statuses.delete(listener);
        statusCleanup();
      };
    },
    async emit(event) {
      events.forEach((listener) => listener(event));
      await Promise.resolve();
    },
    async emitStatus(connection, resyncGeneration) {
      snapshot = { connection, resyncGeneration };
      statuses.forEach((listener) => listener(snapshot));
      await Promise.resolve();
    },
  };
}

let realtime = fakeThreadRealtimeFeed();

function useConfiguredThread(
  overrides: Partial<UseMessageThreadOptions> = {}
): UseMessageThreadResult {
  return useMessageThread({
    accountId: BRANCH_ID,
    conversationId: CONVERSATION_ID,
    role: 'agent',
    conversations,
    messages,
    realtime,
    ...overrides,
  });
}

beforeEach(() => {
  conversations.get.mockReset().mockResolvedValue(conversation());
  conversations.markRead.mockReset().mockResolvedValue(undefined);
  messages.list
    .mockReset()
    .mockResolvedValue(
      page([
        message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T08:01:00.000Z' }),
        message({ id: MESSAGE_2_ID, createdAt: '2026-09-01T08:02:00.000Z' }),
      ])
    );
  messages.get.mockReset().mockResolvedValue(message());
  realtime = fakeThreadRealtimeFeed();
});

describe('useMessageThread', () => {
  it('loads the verified conversation and latest chronological message page', async () => {
    const { result } = renderHook(() =>
      useMessageThread({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        role: 'agent',
        conversations,
        messages,
        realtime,
      })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
    expect(conversations.markRead).toHaveBeenCalledWith(
      BRANCH_ID,
      CONVERSATION_ID
    );
  });

  it('does not clear shared unread state for a viewer', async () => {
    renderHook(() =>
      useMessageThread({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        role: 'viewer',
        conversations,
        messages,
        realtime,
      })
    );
    await waitFor(() => expect(messages.list).toHaveBeenCalled());
    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it('publishes unavailable when the verified conversation is missing', async () => {
    conversations.get.mockRejectedValueOnce(
      new Error('Conversation is unavailable')
    );
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.items).toEqual([]);
    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it('publishes a fixed recoverable error when the initial load fails', async () => {
    messages.list.mockRejectedValueOnce(new Error('Database details'));
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Could not load messages');
    expect(result.current.items).toEqual([]);
  });

  it('keeps readable history and warns when clearing unread fails', async () => {
    conversations.markRead.mockRejectedValueOnce(new Error('Denied'));
    const { result } = renderHook(() => useConfiguredThread());

    await waitFor(() =>
      expect(result.current.unreadWarning).toBe(
        'Could not clear unread messages'
      )
    );
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(2);
  });

  it('retries a failed unread clear on refresh', async () => {
    conversations.markRead
      .mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() =>
      expect(result.current.unreadWarning).toBe(
        'Could not clear unread messages'
      )
    );

    act(() => result.current.refresh());

    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.unreadWarning).toBeNull());
  });

  it('deduplicates inserts and ignores updates for another thread', async () => {
    messages.get.mockResolvedValueOnce(
      message({
        id: MESSAGE_0_ID,
        createdAt: '2026-09-01T08:00:00.000Z',
      })
    );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: OTHER_CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: ABSENT_MESSAGE_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      });
    });
    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual([
        MESSAGE_0_ID,
        MESSAGE_1_ID,
        MESSAGE_2_ID,
      ])
    );
    expect(messages.get).toHaveBeenCalledTimes(1);
  });

  it('hydrates a delivery update only for an existing message id', async () => {
    messages.get.mockResolvedValueOnce(
      message({ id: MESSAGE_2_ID, senderType: 'agent', status: 'read' })
    );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_2_ID,
      })
    );
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === MESSAGE_2_ID)?.status
      ).toBe('read')
    );
  });

  it('removes a matching message after a delete event', async () => {
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );

    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_2_ID]);
  });

  it('coalesces concurrent hydrations for the same message id', async () => {
    const hydrate = deferred<InboxMessage>();
    messages.get.mockReturnValueOnce(hydrate.promise);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const event: InboxRealtimeEvent = {
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_0_ID,
    };

    await act(async () => {
      await Promise.all([realtime.emit(event), realtime.emit(event)]);
    });

    expect(messages.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      hydrate.resolve(
        message({
          id: MESSAGE_0_ID,
          createdAt: '2026-09-01T08:00:00.000Z',
        })
      );
      await hydrate.promise;
      await Promise.resolve();
    });
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
  });

  it('replaces the authoritative header and handles conversation deletion', async () => {
    const updated = conversation({ status: 'closed', unreadCount: 0 });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await waitFor(() => expect(result.current.conversation).toEqual(updated));

    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    expect(result.current.status).toBe('unavailable');
    expect(result.current.conversation).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it('clears unread once while inbound insert clearing is already in flight', async () => {
    const clearing = deferred<void>();
    messages.get
      .mockResolvedValueOnce(message({ id: MESSAGE_0_ID }))
      .mockResolvedValueOnce(message({ id: MESSAGE_3_ID }));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    conversations.markRead.mockClear().mockReturnValue(clearing.promise);

    await act(async () => {
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      });
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_3_ID,
      });
    });

    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      clearing.resolve();
      await clearing.promise;
    });
  });

  it('never mutates unread state for a viewer after inbound inserts', async () => {
    messages.get.mockResolvedValueOnce(message({ id: MESSAGE_0_ID }));
    const { result } = renderHook(() =>
      useConfiguredThread({ role: 'viewer' })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      })
    );

    expect(conversations.markRead).not.toHaveBeenCalled();
  });

  it('prepends older history without changing the newest-page order', async () => {
    messages.list
      .mockResolvedValueOnce(
        page(
          [
            message({
              id: MESSAGE_1_ID,
              createdAt: '2026-09-01T08:01:00.000Z',
            }),
            message({
              id: MESSAGE_2_ID,
              createdAt: '2026-09-01T08:02:00.000Z',
            }),
          ],
          { createdAt: '2026-09-01T08:01:00.000Z', id: MESSAGE_1_ID }
        )
      )
      .mockResolvedValueOnce(
        page([
          message({
            id: MESSAGE_0_ID,
            createdAt: '2026-09-01T08:00:00.000Z',
          }),
        ])
      );
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.loadOlder());
    expect(result.current.items.map((item) => item.id)).toEqual([
      MESSAGE_0_ID,
      MESSAGE_1_ID,
      MESSAGE_2_ID,
    ]);
  });

  it('keeps visible history when loading older messages fails', async () => {
    messages.list
      .mockResolvedValueOnce(
        page([message({ id: MESSAGE_1_ID })], {
          createdAt: '2026-09-01T08:01:00.000Z',
          id: MESSAGE_1_ID,
        })
      )
      .mockRejectedValueOnce(new Error('Could not load messages'));
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.loadOlder());
    expect(result.current.items.map((item) => item.id)).toEqual([MESSAGE_1_ID]);
    expect(result.current.paginationError).toBe(
      'Could not load older messages'
    );
  });

  it('refetches the open thread when the shared provider requests resync', async () => {
    const { result } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() => expect(messages.list).toHaveBeenCalledTimes(2));
    expect(conversations.get).toHaveBeenCalledTimes(2);
  });

  it('ignores stale initial completions after the branch and conversation change', async () => {
    const firstConversation = deferred<InboxConversation>();
    const firstMessages = deferred<MessagePage>();
    const nextConversation = conversation({
      id: OTHER_CONVERSATION_ID,
      accountId: OTHER_BRANCH_ID,
    });
    const nextMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    conversations.get
      .mockReturnValueOnce(firstConversation.promise)
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockReturnValueOnce(firstMessages.promise)
      .mockResolvedValueOnce(page([nextMessage]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { accountId: string; conversationId: string }
    >((props) => useConfiguredThread(props), {
      initialProps: {
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
      },
    });

    rerender({
      accountId: OTHER_BRANCH_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );

    await act(async () => {
      firstConversation.resolve(conversation());
      firstMessages.resolve(page([message()]));
      await Promise.all([firstConversation.promise, firstMessages.promise]);
      await Promise.resolve();
    });

    expect(result.current.conversation).toEqual(nextConversation);
    expect(result.current.items).toEqual([nextMessage]);
  });

  it('ignores stale pagination after the conversation changes', async () => {
    const older = deferred<MessagePage>();
    const cursor: MessageCursor = {
      createdAt: '2026-09-01T08:01:00.000Z',
      id: MESSAGE_1_ID,
    };
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    const nextMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })], cursor))
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(page([nextMessage]));
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(nextConversation);
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadOlder());
    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() => expect(result.current.items).toEqual([nextMessage]));
    await act(async () => {
      older.resolve(page([message({ id: MESSAGE_0_ID })]));
      await older.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([nextMessage]);
    expect(result.current.loadingOlder).toBe(false);
  });

  it('ignores stale message hydration after the branch changes', async () => {
    const hydrate = deferred<InboxMessage>();
    messages.get.mockReturnValueOnce(hydrate.promise);
    const nextConversation = conversation({ accountId: OTHER_BRANCH_ID });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockResolvedValueOnce(page([message({ id: MESSAGE_1_ID })]))
      .mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { accountId: string }
    >(({ accountId }) => useConfiguredThread({ accountId }), {
      initialProps: { accountId: BRANCH_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_0_ID,
      })
    );

    rerender({ accountId: OTHER_BRANCH_ID });
    await waitFor(() => expect(result.current.items).toEqual([]));
    await act(async () => {
      hydrate.resolve(message({ id: MESSAGE_0_ID }));
      await hydrate.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
  });

  it('ignores a stale conversation-header refresh after the conversation changes', async () => {
    const header = deferred<InboxConversation>();
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(header.promise)
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );

    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );
    await act(async () => {
      header.resolve(conversation({ status: 'closed' }));
      await header.promise;
      await Promise.resolve();
    });

    expect(result.current.conversation).toEqual(nextConversation);
  });

  it('ignores a stale unread-clear failure after the conversation changes', async () => {
    const oldClear = deferred<void>();
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    conversations.markRead
      .mockReturnValueOnce(oldClear.promise)
      .mockResolvedValueOnce(undefined);
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockResolvedValueOnce(nextConversation);
    messages.list.mockResolvedValue(page([]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() =>
      expect(conversations.markRead).toHaveBeenCalledTimes(1)
    );

    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );
    await act(async () => {
      oldClear.reject(new Error('Denied'));
      try {
        await oldClear.promise;
      } catch {
        // The hook consumes this failure; the test only settles the deferred.
      }
      await Promise.resolve();
    });

    expect(result.current.unreadWarning).toBeNull();
  });

  it('ignores a stale resync completion after the conversation changes', async () => {
    const resyncConversation = deferred<InboxConversation>();
    const resyncMessages = deferred<MessagePage>();
    const nextConversation = conversation({ id: OTHER_CONVERSATION_ID });
    const nextMessage = message({
      id: MESSAGE_3_ID,
      conversationId: OTHER_CONVERSATION_ID,
    });
    conversations.get
      .mockResolvedValueOnce(conversation())
      .mockReturnValueOnce(resyncConversation.promise)
      .mockResolvedValueOnce(nextConversation);
    messages.list
      .mockResolvedValueOnce(page([]))
      .mockReturnValueOnce(resyncMessages.promise)
      .mockResolvedValueOnce(page([nextMessage]));
    const { result, rerender } = renderHook<
      UseMessageThreadResult,
      { conversationId: string }
    >(({ conversationId }) => useConfiguredThread({ conversationId }), {
      initialProps: { conversationId: CONVERSATION_ID },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => realtime.emitStatus('connected', 1));
    await waitFor(() => expect(conversations.get).toHaveBeenCalledTimes(2));
    rerender({ conversationId: OTHER_CONVERSATION_ID });
    await waitFor(() =>
      expect(result.current.conversation).toEqual(nextConversation)
    );

    await act(async () => {
      resyncConversation.resolve(conversation({ status: 'closed' }));
      resyncMessages.resolve(page([message({ id: MESSAGE_0_ID })]));
      await Promise.all([resyncConversation.promise, resyncMessages.promise]);
      await Promise.resolve();
    });

    expect(result.current.conversation).toEqual(nextConversation);
    expect(result.current.items).toEqual([nextMessage]);
  });

  it('removes both local realtime listeners on cleanup', async () => {
    const { result, unmount } = renderHook(() => useConfiguredThread());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    unmount();

    expect(realtime.eventCleanup).toHaveBeenCalledTimes(1);
    expect(realtime.statusCleanup).toHaveBeenCalledTimes(1);
  });
});
