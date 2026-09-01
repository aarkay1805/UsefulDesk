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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
});
