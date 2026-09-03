import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type { InboxRealtimeEvent } from './inbox-realtime';
import type { InboxMessageReaction } from './inbox-types';
import type { ReactionRepository } from './reaction-repository';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_1_ID,
  MESSAGE_2_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
} from './inbox-test-fixtures';
import {
  useMessageReactions,
  type UseMessageReactionsOptions,
} from './use-message-reactions';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = 'ba8df73d-a33e-4236-a93b-357149bc6ea0';

function reaction(
  overrides: Partial<InboxMessageReaction> = {}
): InboxMessageReaction {
  return {
    id: 'f34de80d-cdf4-4699-ac10-b0a1f0404cab',
    messageId: MESSAGE_1_ID,
    conversationId: CONVERSATION_ID,
    actorType: 'agent',
    actorId: USER_ID,
    emoji: '👍',
    createdAt: '2026-09-03T06:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function realtimeFeed() {
  const listeners = new Set<(event: InboxRealtimeEvent) => void>();
  const statusListeners = new Set<
    (snapshot: { connection: 'connected'; resyncGeneration: number }) => void
  >();
  let snapshot = { connection: 'connected' as const, resyncGeneration: 0 };
  return {
    feed: {
      getSnapshot: () => snapshot,
      listen(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      listenStatus(listener) {
        statusListeners.add(listener as never);
        return () => statusListeners.delete(listener as never);
      },
    } satisfies InboxRealtimeFeed,
    emit(event: InboxRealtimeEvent) {
      listeners.forEach((listener) => listener(event));
    },
    resync() {
      snapshot = {
        connection: 'connected',
        resyncGeneration: snapshot.resyncGeneration + 1,
      };
      statusListeners.forEach((listener) => listener(snapshot));
    },
  };
}

function options(overrides: Partial<UseMessageReactionsOptions> = {}) {
  const realtime = realtimeFeed();
  const repository: ReactionRepository = {
    list: jest.fn().mockResolvedValue([]),
  };
  const mutate = jest.fn().mockResolvedValue(undefined);
  return {
    value: {
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      currentUserId: USER_ID,
      canMutate: true,
      realtime: realtime.feed,
      repository,
      mutate,
      ...overrides,
    },
    mutate,
    realtime,
    repository,
  };
}

describe('useMessageReactions', () => {
  it('loads the selected conversation and resyncs only for its reaction events', async () => {
    const setup = options();
    jest
      .mocked(setup.repository.list)
      .mockResolvedValueOnce([reaction()])
      .mockResolvedValueOnce([reaction({ emoji: '❤️' })]);
    const { result } = renderHook(() => useMessageReactions(setup.value));

    await waitFor(() => expect(result.current.reactions).toEqual([reaction()]));

    act(() => {
      setup.realtime.emit({
        table: 'message_reactions',
        eventType: 'INSERT',
        accountId: OTHER_BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      });
      setup.realtime.emit({
        table: 'message_reactions',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: OTHER_CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      });
    });
    expect(setup.repository.list).toHaveBeenCalledTimes(1);

    act(() => {
      setup.realtime.emit({
        table: 'message_reactions',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      });
    });
    await waitFor(() => expect(result.current.reactions[0]?.emoji).toBe('❤️'));
    expect(setup.repository.list).toHaveBeenCalledTimes(2);
  });

  it('optimistically swaps its own reaction and rolls back only that actor on failure', async () => {
    const attempt = deferred<void>();
    const customerReaction = reaction({
      id: '5d7459ed-c7d6-468e-8238-20cc818ba63e',
      actorType: 'customer',
      actorId: CUSTOMER_ID,
    });
    const setup = options();
    jest
      .mocked(setup.repository.list)
      .mockResolvedValue([reaction(), customerReaction]);
    setup.mutate.mockReturnValue(attempt.promise);
    const { result } = renderHook(() => useMessageReactions(setup.value));
    await waitFor(() => expect(result.current.reactions).toHaveLength(2));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setReaction(MESSAGE_1_ID, '😂');
    });
    expect(
      result.current.reactions.find((item) => item.actorId === USER_ID)?.emoji
    ).toBe('😂');
    expect(result.current.pendingMessageIds.has(MESSAGE_1_ID)).toBe(true);

    await act(async () => {
      attempt.reject(new Error('network'));
      await pending;
    });
    expect(
      result.current.reactions.find((item) => item.actorId === USER_ID)?.emoji
    ).toBe('👍');
    expect(
      result.current.reactions.find((item) => item.actorId === CUSTOMER_ID)
    ).toEqual(customerReaction);
    expect(result.current.error).toBe('Could not update reaction. Try again.');
    expect(result.current.pendingMessageIds.has(MESSAGE_1_ID)).toBe(false);
  });

  it('turns a tap on its own reaction into an optimistic removal', async () => {
    const attempt = deferred<void>();
    const setup = options();
    jest.mocked(setup.repository.list).mockResolvedValue([reaction()]);
    setup.mutate.mockReturnValue(attempt.promise);
    const { result } = renderHook(() => useMessageReactions(setup.value));
    await waitFor(() => expect(result.current.reactions).toHaveLength(1));

    act(() => {
      void result.current.toggleReaction(MESSAGE_1_ID, '👍');
    });

    expect(result.current.reactions).toEqual([]);
    expect(setup.mutate).toHaveBeenCalledWith(MESSAGE_1_ID, '');
    await act(async () => {
      attempt.resolve();
      await attempt.promise;
    });
  });

  it('ignores late loads and failed mutations after the conversation scope changes', async () => {
    const oldLoad = deferred<InboxMessageReaction[]>();
    const oldMutation = deferred<void>();
    const setup = options();
    jest
      .mocked(setup.repository.list)
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce([
        reaction({
          id: 'f3af6f1e-89c8-49c5-95dd-f806dffbfa99',
          conversationId: OTHER_CONVERSATION_ID,
          messageId: MESSAGE_2_ID,
          emoji: '🙏',
        }),
      ]);
    setup.mutate.mockReturnValue(oldMutation.promise);
    const { result, rerender } = renderHook(
      (props: UseMessageReactionsOptions) => useMessageReactions(props),
      { initialProps: setup.value }
    );

    act(() => {
      void result.current.setReaction(MESSAGE_1_ID, '😂');
    });
    rerender({
      ...setup.value,
      conversationId: OTHER_CONVERSATION_ID,
    });
    await waitFor(() =>
      expect(result.current.reactions[0]?.conversationId).toBe(
        OTHER_CONVERSATION_ID
      )
    );

    await act(async () => {
      oldLoad.resolve([reaction({ emoji: '❤️' })]);
      oldMutation.reject(new Error('late failure'));
      await Promise.allSettled([oldLoad.promise, oldMutation.promise]);
    });

    expect(result.current.reactions[0]?.conversationId).toBe(
      OTHER_CONVERSATION_ID
    );
    expect(result.current.error).toBeNull();
  });

  it('keeps viewers read-only even if a stale UI calls the mutation boundary', async () => {
    const setup = options({ canMutate: false });
    const { result } = renderHook(() => useMessageReactions(setup.value));
    await waitFor(() => expect(setup.repository.list).toHaveBeenCalled());

    await act(async () => {
      await result.current.setReaction(MESSAGE_1_ID, '👍');
    });

    expect(setup.mutate).not.toHaveBeenCalled();
    expect(result.current.reactions).toEqual([]);
  });
});
