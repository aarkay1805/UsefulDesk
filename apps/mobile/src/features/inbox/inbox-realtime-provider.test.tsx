import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import type { AppStateStatus } from 'react-native';

import {
  InboxRealtimeProvider,
  type InboxAppStateSource,
  type InboxRealtimeFeed,
  useInboxRealtimeFeed,
} from './inbox-realtime-provider';
import type {
  InboxConnectionState,
  InboxRealtimeEvent,
  SubscribeInboxRealtimeOptions,
} from './inbox-realtime';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_1_ID,
  OTHER_BRANCH_ID,
} from './inbox-test-fixtures';

function fakeAppStateSource(): InboxAppStateSource & {
  emit(state: AppStateStatus): void;
  removals: jest.Mock[];
} {
  let callback: ((state: AppStateStatus) => void) | null = null;
  const removals: jest.Mock[] = [];
  return {
    currentState: 'active',
    addEventListener: jest.fn((_event, next) => {
      callback = next;
      const remove = jest.fn(() => {
        if (callback === next) callback = null;
      });
      removals.push(remove);
      return { remove };
    }),
    emit(state) {
      callback?.(state);
    },
    removals,
  };
}

function messageEvent(accountId: string): InboxRealtimeEvent {
  return {
    table: 'messages',
    eventType: 'INSERT',
    accountId,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_1_ID,
  };
}

describe('InboxRealtimeProvider', () => {
  it('owns one channel per branch and emits one shared resync generation', async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const connectionCallback: {
      current: ((state: InboxConnectionState) => void) | null;
    } = { current: null };
    const subscribe = jest.fn(
      async (options: SubscribeInboxRealtimeOptions) => {
        connectionCallback.current = options.onConnectionChange;
        return cleanup;
      }
    );
    const appState = fakeAppStateSource();
    const observedRef: { current: InboxRealtimeFeed | null } = {
      current: null,
    };
    const Probe = () => {
      const currentFeed = useInboxRealtimeFeed();
      useEffect(() => {
        observedRef.current = currentFeed;
      }, [currentFeed]);
      return null;
    };
    const { rerender, unmount } = render(
      <InboxRealtimeProvider
        accountId={BRANCH_ID}
        appState={appState}
        subscribe={subscribe}
      >
        <Probe />
      </InboxRealtimeProvider>
    );

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    act(() => connectionCallback.current?.('connected'));
    expect(observedRef.current?.getSnapshot().resyncGeneration).toBe(0);
    act(() => connectionCallback.current?.('disconnected'));
    act(() => connectionCallback.current?.('connected'));
    await waitFor(() =>
      expect(observedRef.current?.getSnapshot().resyncGeneration).toBe(1)
    );
    act(() => appState.emit('background'));
    act(() => appState.emit('active'));
    await waitFor(() =>
      expect(observedRef.current?.getSnapshot().resyncGeneration).toBe(2)
    );

    rerender(
      <InboxRealtimeProvider
        accountId={OTHER_BRANCH_ID}
        appState={appState}
        subscribe={subscribe}
      >
        <Probe />
      </InboxRealtimeProvider>
    );

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(observedRef.current?.getSnapshot()).toEqual({
      connection: 'connecting',
      resyncGeneration: 0,
    });
    expect(appState.addEventListener).toHaveBeenCalledTimes(2);
    expect(appState.removals[0]).toHaveBeenCalledTimes(1);

    unmount();
    await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
    expect(appState.removals[1]).toHaveBeenCalledTimes(1);
  });

  it('changes feed identity by branch and ignores late old-branch callbacks', async () => {
    const subscriptions: SubscribeInboxRealtimeOptions[] = [];
    const cleanups: jest.Mock[] = [];
    const subscribe = jest.fn(
      async (options: SubscribeInboxRealtimeOptions) => {
        subscriptions.push(options);
        const cleanup = jest.fn().mockResolvedValue(undefined);
        cleanups.push(cleanup);
        return cleanup;
      }
    );
    const appState = fakeAppStateSource();
    const observedRef: { current: InboxRealtimeFeed | null } = {
      current: null,
    };
    const Probe = () => {
      const currentFeed = useInboxRealtimeFeed();
      useEffect(() => {
        observedRef.current = currentFeed;
      }, [currentFeed]);
      return null;
    };
    const { rerender, unmount } = render(
      <InboxRealtimeProvider
        accountId={BRANCH_ID}
        appState={appState}
        subscribe={subscribe}
      >
        <Probe />
      </InboxRealtimeProvider>
    );
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    const firstFeed = observedRef.current!;
    const firstListener = jest.fn();
    firstFeed.listen(firstListener);
    act(() => subscriptions[0]!.onEvent(messageEvent(BRANCH_ID)));
    expect(firstListener).toHaveBeenCalledTimes(1);

    rerender(
      <InboxRealtimeProvider
        accountId={OTHER_BRANCH_ID}
        appState={appState}
        subscribe={subscribe}
      >
        <Probe />
      </InboxRealtimeProvider>
    );
    await waitFor(() => expect(subscriptions).toHaveLength(2));
    expect(observedRef.current).not.toBe(firstFeed);
    const secondListener = jest.fn();
    observedRef.current!.listen(secondListener);

    act(() => {
      subscriptions[0]!.onEvent(messageEvent(BRANCH_ID));
      subscriptions[0]!.onConnectionChange('connected');
      subscriptions[1]!.onEvent(messageEvent(OTHER_BRANCH_ID));
    });

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(observedRef.current!.getSnapshot()).toEqual({
      connection: 'connecting',
      resyncGeneration: 0,
    });

    unmount();
    await waitFor(() => {
      expect(cleanups[0]).toHaveBeenCalledTimes(1);
      expect(cleanups[1]).toHaveBeenCalledTimes(1);
    });
  });

  it('throws a fixed developer error outside the provider', () => {
    const Probe = () => {
      useInboxRealtimeFeed();
      return null;
    };

    expect(() => render(<Probe />)).toThrow(
      'useInboxRealtimeFeed must be used within InboxRealtimeProvider.'
    );
  });
});
