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
    expect(result.current.search).toBe('   ');
    await act(async () => {
      initial.resolve(page([conversationA]));
      await initial.promise;
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([conversationA]);
    expect(result.current.status).toBe('ready');
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('preserves spaces while typing a multi-word search one character at a time', async () => {
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let typed = '';
    for (const character of 'Rajat Kashyap') {
      typed += character;
      await act(async () =>
        result.current.setSearch(result.current.search + character)
      );
      expect(result.current.search).toBe(typed);
    }

    expect(repository.list).toHaveBeenLastCalledWith({
      accountId: BRANCH_A,
      filter: 'all',
      search: 'Rajat Kashyap',
      cursor: null,
    });
  });

  it('preserves raw deletions and clears the normalized query', async () => {
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.setSearch(' Rajat K'));

    for (const value of [' Rajat ', ' Rajat', ' Raj', ' ', '']) {
      await act(async () => result.current.setSearch(value));
      expect(result.current.search).toBe(value);
    }

    expect(repository.list.mock.calls.map(([input]) => input.search)).toEqual([
      '',
      'Rajat K',
      'Rajat',
      'Raj',
      '',
    ]);
    expect(result.current.status).toBe('ready');
  });

  it('keeps loaded rows and pending pagination through equivalent search edits', async () => {
    const cursor: ConversationCursor = {
      phase: 'messaged',
      lastMessageAt: conversationA.lastMessageAt!,
      id: conversationA.id,
    };
    const older = conversation({ id: OTHER_CONVERSATION_ID });
    const nextPage = deferred<ConversationPage>();
    repository.list
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([conversationA], cursor))
      .mockReturnValueOnce(nextPage.promise);
    const { result } = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime })
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.setSearch('Rajat K'));

    for (const value of [' Rajat K ', 'Rajat  K', 'Rajat_K']) {
      act(() => result.current.setSearch(value));
      expect(result.current.search).toBe(value);
      expect(result.current.items).toEqual([conversationA]);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.refreshing).toBe(false);
      expect(repository.list).toHaveBeenCalledTimes(2);
      expect(repository.unreadCount).toHaveBeenCalledTimes(2);
    }

    act(() => result.current.loadMore());
    act(() => result.current.setSearch('Rajat K  '));
    expect(result.current.search).toBe('Rajat K  ');
    expect(result.current.loadingMore).toBe(true);
    expect(repository.list).toHaveBeenLastCalledWith({
      accountId: BRANCH_A,
      filter: 'all',
      search: 'Rajat K',
      cursor,
    });
    await act(async () => nextPage.resolve(page([older])));

    expect(result.current.items).toEqual([conversationA, older]);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
    expect(repository.list).toHaveBeenCalledTimes(3);
    expect(repository.unreadCount).toHaveBeenCalledTimes(2);
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

describe('loaded conversation range refresh', () => {
  let rows: InboxConversation[];
  let feed: ReturnType<typeof fakeRealtimeFeed>;
  const cursorFor = (item: InboxConversation): ConversationCursor =>
    item.lastMessageAt
      ? { phase: 'messaged', lastMessageAt: item.lastMessageAt, id: item.id }
      : { phase: 'empty', createdAt: item.createdAt, id: item.id };
  const event = (
    item: InboxConversation
  ): Extract<InboxRealtimeEvent, { table: 'messages' }> => ({
    table: 'messages',
    eventType: 'UPDATE',
    accountId: BRANCH_A,
    conversationId: item.id,
    messageId: MESSAGE_1_ID,
  });

  beforeEach(() => {
    feed = fakeRealtimeFeed();
    rows = Array.from({ length: 80 }, (_, index) =>
      conversation({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        lastMessageAt:
          index < 45
            ? new Date(Date.UTC(2026, 8, 1, 12, 0, -index)).toISOString()
            : null,
        createdAt: new Date(Date.UTC(2026, 8, 2, 12, 0, -index)).toISOString(),
        lastMessageText: 'renewal',
        unreadCount: 1,
      })
    );
    repository.list.mockImplementation(async (input) => {
      const matching = rows.filter(
        (item) =>
          item.accountId === input.accountId &&
          (input.filter !== 'unread' || item.unreadCount > 0) &&
          (!input.search || item.lastMessageText?.includes(input.search))
      );
      const start = input.cursor
        ? matching.findIndex((item) => item.id === input.cursor!.id) + 1
        : 0;
      const items = matching.slice(start, start + (input.limit ?? 30));
      return page(
        items,
        start + items.length < matching.length
          ? cursorFor(items[items.length - 1])
          : null
      );
    });
    repository.unreadCount.mockImplementation(
      async () => rows.filter((item) => item.unreadCount > 0).length
    );
    repository.get.mockImplementation(async (_, id) => {
      const item = rows.find((row) => row.id === id);
      if (!item) throw new Error('Unavailable');
      return item;
    });
  });

  async function loaded() {
    const rendered = renderHook(() =>
      useConversationList({ accountId: BRANCH_A, repository, realtime: feed })
    );
    await waitFor(() => expect(rendered.result.current.items).toHaveLength(30));
    await act(async () => rendered.result.current.loadMore());
    expect(rendered.result.current.items).toHaveLength(60);
    return rendered;
  }

  it.each(['message', 'delivery', 'reaction'] as const)(
    'retains two pages after a %s event and continues from the refreshed empty-phase cursor',
    async (kind) => {
      const { result } = await loaded();
      const changed = rows[40];
      await act(async () =>
        feed.emit({
          ...event(changed),
          table: kind === 'reaction' ? 'message_reactions' : 'messages',
          eventType: kind === 'delivery' ? 'UPDATE' : 'INSERT',
        })
      );
      await waitFor(() => expect(result.current.refreshing).toBe(false));
      expect(result.current.items).toEqual(rows.slice(0, 60));
      expect(
        repository.list.mock.calls.slice(2).map(([input]) => input.limit ?? 30)
      ).toEqual([30, 30]);
      await act(async () => result.current.loadMore());
      expect(repository.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: cursorFor(rows[59]) })
      );
      expect(result.current.items).toEqual(rows);
      expect(result.current.hasMore).toBe(false);
    }
  );

  it.each(['manual', 'foreground', 'reconnect'] as const)(
    'keeps the loaded range during a %s refresh',
    async (kind) => {
      const { result } = await loaded();
      if (kind === 'manual') await act(async () => result.current.refresh());
      else
        await act(async () =>
          feed.emitStatus('connected', kind === 'foreground' ? 1 : 2)
        );
      await waitFor(() => expect(result.current.refreshing).toBe(false));
      expect(result.current.items).toEqual(rows.slice(0, 60));
    }
  );

  it('replaces changed ordering and query membership authoritatively, with exact unread count', async () => {
    const { result } = await loaded();
    await act(async () => result.current.setFilter('unread'));
    await act(async () => result.current.setSearch('renewal'));
    await act(async () => result.current.loadMore());
    expect(result.current.items).toHaveLength(60);
    const removed = rows[35];
    rows[35] = { ...removed, unreadCount: 0 };
    rows[36] = { ...rows[36], lastMessageText: 'different' };
    const promoted = { ...rows[40], lastMessageAt: '2026-09-03T12:00:00.000Z' };
    rows = [promoted, ...rows.filter((row) => row.id !== promoted.id)];
    await act(async () => feed.emit(event(promoted)));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    const matching = rows.filter(
      (row) => row.unreadCount > 0 && row.lastMessageText === 'renewal'
    );
    expect(result.current.items).toEqual(matching.slice(0, 60));
    expect(result.current.unreadCount).toBe(79);
    await act(async () => result.current.loadMore());
    expect(result.current.items).toEqual(matching);
  });

  it('retains every loaded row and its continuation when a later refresh page fails', async () => {
    const { result } = await loaded();
    const snapshot = [...result.current.items];
    repository.list
      .mockResolvedValueOnce(page(rows.slice(0, 30), cursorFor(rows[29])))
      .mockRejectedValueOnce(new Error('offline'));
    await act(async () => feed.emit(event(rows[0])));
    await waitFor(() =>
      expect(result.current.refreshWarning).toBe(
        'Could not refresh conversations'
      )
    );
    expect(result.current.items).toEqual(snapshot);
    expect(result.current.hasMore).toBe(true);
    await act(async () => result.current.loadMore());
    expect(result.current.items).toEqual(rows);
  });

  it('bounds partial last-page requests to the loaded depth', async () => {
    const { result } = await loaded();
    await act(async () => result.current.loadMore());
    expect(result.current.items).toHaveLength(80);
    repository.list.mockClear();
    await act(async () => feed.emit(event(rows[0])));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(
      repository.list.mock.calls.map(([input]) => input.limit ?? 30)
    ).toEqual([30, 30, 20]);
    expect(result.current.items).toEqual(rows);
    expect(result.current.hasMore).toBe(false);
  });

  it('coalesces an event burst and never restores a deleted row from a stale later page', async () => {
    const { result } = await loaded();
    const removed = rows[40];
    const staleTail = deferred<ConversationPage>();
    const stalePage = page(rows.slice(30, 60), cursorFor(rows[59]));
    repository.list
      .mockClear()
      .mockResolvedValueOnce(page(rows.slice(0, 30), cursorFor(rows[29])))
      .mockReturnValueOnce(staleTail.promise);
    await act(async () => feed.emit(event(rows[0])));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));
    rows = rows.filter((row) => row.id !== removed.id);
    await act(async () => {
      await feed.emit({
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_A,
        conversationId: removed.id,
        messageId: null,
      });
      for (let index = 0; index < 8; index += 1)
        await feed.emit(event(rows[0]));
    });
    expect(result.current.items.some((row) => row.id === removed.id)).toBe(
      false
    );
    await act(async () => staleTail.resolve(stalePage));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(repository.list).toHaveBeenCalledTimes(4);
    expect(result.current.items.some((row) => row.id === removed.id)).toBe(
      false
    );
    expect(result.current.unreadCount).toBe(79);
    expect(result.current.items.length).toBeGreaterThanOrEqual(59);
  });

  it('does not let a late hydrate resurrect a row excluded by the completed snapshot', async () => {
    const { result } = await loaded();
    const removed = rows[40];
    const hydrate = deferred<InboxConversation>();
    repository.get.mockReturnValueOnce(hydrate.promise);
    rows = rows.filter((row) => row.id !== removed.id);
    await act(async () => feed.emit(event(removed)));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.items.some((row) => row.id === removed.id)).toBe(
      false
    );
    await act(async () => hydrate.resolve(removed));
    expect(result.current.items).toEqual(rows.slice(0, 60));
  });

  it.each(['branch', 'search', 'filter', 'feed'] as const)(
    'stops an obsolete range scan when the %s changes',
    async (kind) => {
      const { result, rerender } = renderHook<
        UseConversationListResult,
        { accountId: string; realtime: InboxRealtimeFeed }
      >(
        ({ accountId, realtime: currentFeed }) =>
          useConversationList({ accountId, repository, realtime: currentFeed }),
        {
          initialProps: {
            accountId: BRANCH_A,
            realtime: feed as InboxRealtimeFeed,
          },
        }
      );
      await waitFor(() => expect(result.current.items).toHaveLength(30));
      await act(async () => result.current.loadMore());
      const stale = deferred<ConversationPage>();
      repository.list.mockReturnValueOnce(stale.promise);
      await act(async () => feed.emit(event(rows[0])));
      if (kind === 'branch') rerender({ accountId: BRANCH_B, realtime: feed });
      if (kind === 'search')
        await act(async () => result.current.setSearch('absent'));
      if (kind === 'filter')
        await act(async () => result.current.setFilter('unread'));
      if (kind === 'feed')
        rerender({ accountId: BRANCH_A, realtime: fakeRealtimeFeed() });
      await waitFor(() => expect(result.current.refreshing).toBe(false));
      const expected =
        kind === 'feed'
          ? rows.slice(0, 60)
          : kind === 'filter'
            ? rows.slice(0, 30)
            : [];
      expect(result.current.items).toEqual(expected);
      const calls = repository.list.mock.calls.length;
      await act(async () =>
        stale.resolve(page(rows.slice(0, 30), cursorFor(rows[29])))
      );
      expect(repository.list).toHaveBeenCalledTimes(calls);
      expect(result.current.items).toEqual(expected);
    }
  );

  it('deduplicates refresh pages and refuses nonadvancing cursors', async () => {
    const { result } = await loaded();
    const snapshot = [...result.current.items];
    repository.list
      .mockResolvedValueOnce(page(rows.slice(0, 30), cursorFor(rows[29])))
      .mockResolvedValueOnce(
        page([rows[29], ...rows.slice(31, 60)], cursorFor(rows[59]))
      );
    await act(async () => feed.emit(event(rows[0])));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(new Set(result.current.items.map((row) => row.id)).size).toBe(
      result.current.items.length
    );
    expect(result.current.items).toEqual(
      snapshot.filter((row) => row.id !== rows[30].id)
    );
    const beforeFailure = [...result.current.items];
    repository.list
      .mockResolvedValueOnce(page(rows.slice(0, 30), cursorFor(rows[29])))
      .mockResolvedValueOnce(page(rows.slice(0, 30), cursorFor(rows[29])));
    await act(async () => feed.emit(event(rows[0])));
    await waitFor(() =>
      expect(result.current.refreshWarning).toBe(
        'Could not refresh conversations'
      )
    );
    expect(result.current.items).toEqual(beforeFailure);
  });
});
