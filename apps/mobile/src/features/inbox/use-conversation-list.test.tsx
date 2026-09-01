import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ConversationRepository } from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type {
  InboxConnectionState,
  InboxRealtimeEvent,
} from './inbox-realtime';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_1_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
  conversation,
  page,
} from './inbox-test-fixtures';
import type {
  ConversationCursor,
  InboxConversation,
  Page,
} from './inbox-types';
import {
  type UseConversationListResult,
  useConversationList,
} from './use-conversation-list';

type ConversationPage = Page<InboxConversation, ConversationCursor>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function fakeRealtimeFeed(): InboxRealtimeFeed & {
  eventCleanup: jest.Mock;
  statusCleanup: jest.Mock;
  emit(event: InboxRealtimeEvent): Promise<void>;
  emitStatus(
    connection: InboxConnectionState,
    resyncGeneration: number
  ): Promise<void>;
} {
  const eventListeners = new Set<(event: InboxRealtimeEvent) => void>();
  const statusListeners = new Set<
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
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
        eventCleanup();
      };
    },
    listenStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
        statusCleanup();
      };
    },
    async emit(event) {
      eventListeners.forEach((listener) => listener(event));
      await Promise.resolve();
    },
    async emitStatus(connection, resyncGeneration) {
      snapshot = { connection, resyncGeneration };
      statusListeners.forEach((listener) => listener(snapshot));
      await Promise.resolve();
    },
  };
}

const BRANCH_A = BRANCH_ID;
const BRANCH_B = OTHER_BRANCH_ID;
const conversationA = conversation({ accountId: BRANCH_A });
const conversationB = conversation({
  id: '0c096d41-c240-4a63-bd04-46f96ba3c810',
  accountId: BRANCH_B,
});
const repository: jest.Mocked<ConversationRepository> = {
  list: jest.fn().mockResolvedValue(page([conversationA])),
  unreadCount: jest.fn().mockResolvedValue(3),
  get: jest.fn().mockResolvedValue(conversationA),
  markRead: jest.fn().mockResolvedValue(undefined),
};
const realtime = fakeRealtimeFeed();

beforeEach(() => {
  repository.list.mockReset().mockResolvedValue(page([conversationA]));
  repository.unreadCount.mockReset().mockResolvedValue(3);
  repository.get.mockReset().mockResolvedValue(conversationA);
  repository.markRead.mockReset().mockResolvedValue(undefined);
  realtime.eventCleanup.mockClear();
  realtime.statusCleanup.mockClear();
});

describe('useConversationList', () => {
  it('loads the current branch and ignores a stale response after branch change', async () => {
    const first = deferred<ConversationPage>();
    repository.list
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(page([conversationB]));
    const { result, rerender } = renderHook<
      UseConversationListResult,
      { accountId: string }
    >(
      ({ accountId }) =>
        useConversationList({ accountId, repository, realtime }),
      { initialProps: { accountId: BRANCH_A } }
    );
    rerender({ accountId: BRANCH_B });
    await waitFor(() => expect(result.current.items).toEqual([conversationB]));
    first.resolve(page([conversationA]));
    await act(async () => Promise.resolve());
    expect(result.current.items).toEqual([conversationB]);
  });

  it('hides previous branch rows when the new branch load fails', async () => {
    repository.list
      .mockResolvedValueOnce(page([conversationA]))
      .mockRejectedValueOnce(new Error('Could not load conversations'));
    repository.unreadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
    const { result, rerender } = renderHook<
      UseConversationListResult,
      { accountId: string }
    >(
      ({ accountId }) =>
        useConversationList({ accountId, repository, realtime }),
      { initialProps: { accountId: BRANCH_A } }
    );
    await waitFor(() => expect(result.current.items).toEqual([conversationA]));

    rerender({ accountId: BRANCH_B });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('clears previous query rows when the new query load fails', async () => {
    repository.list
      .mockResolvedValueOnce(page([conversationA]))
      .mockRejectedValueOnce(new Error('Could not load conversations'));
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.items).toEqual([conversationA]));

    act(() => result.current.setSearch('renewal'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
    expect(result.current.refreshWarning).toBeNull();
  });

  it('preserves visible rows and warns when manual refresh fails', async () => {
    repository.list
      .mockResolvedValueOnce(page([conversationA]))
      .mockRejectedValueOnce(new Error('Could not load conversations'));
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.refresh());

    await waitFor(() =>
      expect(result.current.refreshWarning).toBe(
        'Could not refresh conversations'
      )
    );
    expect(result.current.items).toEqual([conversationA]);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it('preserves visible rows across failed foreground and reconnect resyncs', async () => {
    const resyncRealtime = fakeRealtimeFeed();
    repository.list
      .mockResolvedValueOnce(page([conversationA]))
      .mockRejectedValueOnce(new Error('Foreground refresh failed'))
      .mockRejectedValueOnce(new Error('Reconnect refresh failed'));
    const { result } = renderHook(() =>
      useConversationList({
        accountId: BRANCH_A,
        repository,
        realtime: resyncRealtime,
      })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => resyncRealtime.emitStatus('connected', 1));
    await waitFor(() =>
      expect(result.current.refreshWarning).toBe(
        'Could not refresh conversations'
      )
    );
    expect(result.current.items).toEqual([conversationA]);
    expect(result.current.refreshing).toBe(false);

    await act(async () => resyncRealtime.emitStatus('disconnected', 1));
    await act(async () => resyncRealtime.emitStatus('connected', 2));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.items).toEqual([conversationA]);
    expect(result.current.status).toBe('ready');
    expect(result.current.refreshWarning).toBe(
      'Could not refresh conversations'
    );
  });

  it('shows the full error when an event refresh interrupts the initial load', async () => {
    const initial = deferred<ConversationPage>();
    const eventRealtime = fakeRealtimeFeed();
    repository.list
      .mockReturnValueOnce(initial.promise)
      .mockRejectedValueOnce(new Error('Could not load conversations'));
    const { result } = renderHook(() =>
      useConversationList({
        accountId: BRANCH_A,
        repository,
        realtime: eventRealtime,
      })
    );

    await act(async () =>
      eventRealtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe('Could not load conversations');
    expect(result.current.refreshWarning).toBeNull();
    expect(result.current.refreshing).toBe(false);

    initial.resolve(page([conversationA]));
  });

  it('does not invalidate an in-flight load for a normalized-equivalent search', async () => {
    const initial = deferred<ConversationPage>();
    repository.list.mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );

    act(() => result.current.setSearch('   '));
    await act(async () => {
      initial.resolve(page([conversationA]));
      await initial.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([conversationA]);
    expect(result.current.status).toBe('ready');
  });

  it('leaves completed filter, normalized-equivalent search, and cursor unchanged', async () => {
    const cursor: ConversationCursor = {
      phase: 'messaged',
      lastMessageAt: conversationA.lastMessageAt!,
      id: conversationA.id,
    };
    repository.list.mockResolvedValueOnce(page([conversationA], cursor));
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      result.current.setFilter('all');
      result.current.setSearch('   ');
    });

    expect(result.current.hasMore).toBe(true);
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('removes a hydrated read conversation from Unread and refreshes its count', async () => {
    const readConversation = conversation({
      accountId: BRANCH_A,
      unreadCount: 0,
    });
    repository.list
      .mockResolvedValueOnce(page([conversationA]))
      .mockResolvedValueOnce(page([conversationA]))
      .mockResolvedValueOnce(page([]));
    repository.unreadCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    repository.get.mockResolvedValueOnce(readConversation);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setFilter('unread'));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'UPDATE',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );

    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(result.current.unreadCount).toBe(2);
  });

  it('does not insert an unknown hydrated row that misses the active search', async () => {
    repository.list
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([]));
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setSearch('not a match'));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );

    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(3));
    expect(result.current.items).toEqual([]);
  });

  it('refreshes the unread count after deleting an unread conversation', async () => {
    repository.list
      .mockResolvedValueOnce(page([conversationA]))
      .mockResolvedValueOnce(page([conversationA]))
      .mockResolvedValueOnce(page([]));
    repository.unreadCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setFilter('unread'));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));

    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );

    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    expect(result.current.items).toEqual([]);
  });

  it('hydrates an unknown message event only inside the active branch', async () => {
    repository.list.mockResolvedValueOnce(page([]));
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      });
    });
    expect(repository.get).toHaveBeenCalledWith(BRANCH_A, CONVERSATION_ID);
  });

  it('coalesces concurrent hydration for the same unknown conversation', async () => {
    const hydrate = deferred<InboxConversation>();
    repository.list.mockResolvedValueOnce(page([]));
    repository.get.mockReturnValueOnce(hydrate.promise);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const event: InboxRealtimeEvent = {
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_A,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    };
    await act(async () => {
      await Promise.all([realtime.emit(event), realtime.emit(event)]);
    });
    expect(repository.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      hydrate.resolve(conversationA);
      await hydrate.promise;
      await Promise.resolve();
    });
  });

  it('does not restore a conversation when its deferred hydrate loses to delete', async () => {
    const hydrate = deferred<InboxConversation>();
    repository.list.mockResolvedValue(page([]));
    repository.get.mockReturnValueOnce(hydrate.promise);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );
    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await act(async () => {
      hydrate.resolve(conversationA);
      await hydrate.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
  });

  it('does not commit a deferred hydrate after its feed is replaced', async () => {
    const firstRealtime = fakeRealtimeFeed();
    const secondRealtime = fakeRealtimeFeed();
    const hydrate = deferred<InboxConversation>();
    repository.list.mockResolvedValue(page([]));
    repository.get.mockReturnValueOnce(hydrate.promise);
    const { result, rerender } = renderHook<
      UseConversationListResult,
      { realtime: InboxRealtimeFeed }
    >(
      ({ realtime: currentRealtime }) =>
        useConversationList({
          accountId: BRANCH_A,
          repository,
          realtime: currentRealtime,
        }),
      { initialProps: { realtime: firstRealtime } }
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      firstRealtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );

    rerender({ realtime: secondRealtime });
    await act(async () => {
      hydrate.resolve(conversationA);
      await hydrate.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
  });

  it('ignores a broadcast carrying another account id', async () => {
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () =>
      realtime.emit({
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_B,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    );
    expect(repository.get).not.toHaveBeenCalled();
  });

  it('refetches after reconnect and foreground without duplicate listeners', async () => {
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => realtime.emitStatus('disconnected', 0));
    await act(async () => realtime.emitStatus('connected', 1));
    await act(async () => realtime.emitStatus('connected', 2));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(3));
  });

  it('tears down branch listeners and hides old rows on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useConversationList({
        accountId: BRANCH_A,
        repository,
        realtime,
      })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    unmount();
    expect(realtime.eventCleanup).toHaveBeenCalledTimes(1);
    expect(realtime.statusCleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves loaded rows when pagination fails', async () => {
    repository.list
      .mockResolvedValueOnce(
        page([conversationA], {
          phase: 'messaged',
          lastMessageAt: conversationA.lastMessageAt!,
          id: conversationA.id,
        })
      )
      .mockRejectedValueOnce(new Error('Could not load conversations'));
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.loadMore());
    expect(result.current.items).toEqual([conversationA]);
    expect(result.current.paginationError).toBe(
      'Could not load more conversations'
    );
  });

  it('does not append a deferred page after realtime deletes its query membership', async () => {
    const cursor: ConversationCursor = {
      phase: 'messaged',
      lastMessageAt: conversationA.lastMessageAt!,
      id: conversationA.id,
    };
    const more = deferred<ConversationPage>();
    repository.list
      .mockResolvedValueOnce(page([conversationA], cursor))
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(page([]));
    repository.unreadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadMore());
    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await waitFor(() => expect(result.current.items).toEqual([]));
    await act(async () => {
      more.resolve(page([conversationA]));
      await more.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
  });

  it('allows fresh pagination before an invalidated page settles', async () => {
    const initialCursor: ConversationCursor = {
      phase: 'messaged',
      lastMessageAt: conversationA.lastMessageAt!,
      id: conversationA.id,
    };
    const refreshedConversation = conversation({
      id: OTHER_CONVERSATION_ID,
      accountId: BRANCH_A,
    });
    const refreshedCursor: ConversationCursor = {
      phase: 'messaged',
      lastMessageAt: refreshedConversation.lastMessageAt!,
      id: refreshedConversation.id,
    };
    const freshPageConversation = conversation({
      id: '0c096d41-c240-4a63-bd04-46f96ba3c810',
      accountId: BRANCH_A,
    });
    const oldPage = deferred<ConversationPage>();
    const freshPage = deferred<ConversationPage>();
    repository.list
      .mockResolvedValueOnce(page([conversationA], initialCursor))
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce(page([refreshedConversation], refreshedCursor))
      .mockReturnValueOnce(freshPage.promise);
    repository.unreadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.loadMore());
    await act(async () =>
      realtime.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_A,
        conversationId: CONVERSATION_ID,
        messageId: null,
      })
    );
    await waitFor(() =>
      expect(result.current.items).toEqual([refreshedConversation])
    );

    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);

    await act(async () => {
      oldPage.resolve(page([conversationA]));
      await oldPage.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([refreshedConversation]);
    expect(result.current.loadingMore).toBe(true);

    await act(async () => {
      freshPage.resolve(page([freshPageConversation]));
      await freshPage.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([
      refreshedConversation,
      freshPageConversation,
    ]);
    expect(result.current.loadingMore).toBe(false);
  });

  it('deduplicates repeated ids within one pagination page', async () => {
    const cursor: ConversationCursor = {
      phase: 'messaged',
      lastMessageAt: conversationA.lastMessageAt!,
      id: conversationA.id,
    };
    const conversationC = conversation({
      id: OTHER_CONVERSATION_ID,
      accountId: BRANCH_A,
    });
    repository.list
      .mockResolvedValueOnce(page([conversationA], cursor))
      .mockResolvedValueOnce(
        page([conversationA, conversationC, conversationC])
      );
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => result.current.loadMore());

    expect(result.current.items).toEqual([conversationA, conversationC]);
  });
});
