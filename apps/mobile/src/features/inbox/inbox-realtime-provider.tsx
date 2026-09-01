import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  subscribeToInboxRealtime,
  type InboxConnectionState,
  type InboxRealtimeEvent,
} from './inbox-realtime';

interface InboxRealtimeSnapshot {
  connection: InboxConnectionState;
  resyncGeneration: number;
}

export interface InboxRealtimeFeed {
  getSnapshot(): InboxRealtimeSnapshot;
  listen(listener: (event: InboxRealtimeEvent) => void): () => void;
  listenStatus(listener: (snapshot: InboxRealtimeSnapshot) => void): () => void;
}

export interface InboxAppStateSource {
  currentState: AppStateStatus;
  addEventListener(
    event: 'change',
    callback: (state: AppStateStatus) => void
  ): { remove(): void };
}

export interface InboxRealtimeProviderProps {
  accountId: string;
  children: ReactNode;
  appState?: InboxAppStateSource;
  subscribe?: typeof subscribeToInboxRealtime;
}

interface ManagedInboxRealtimeFeed extends InboxRealtimeFeed {
  emit(event: InboxRealtimeEvent): void;
  setConnection(connection: InboxConnectionState, resync: boolean): void;
  requestResync(): void;
  dispose(): void;
}

function createFeed(accountId: string): ManagedInboxRealtimeFeed {
  const eventListeners = new Set<(event: InboxRealtimeEvent) => void>();
  const statusListeners = new Set<(snapshot: InboxRealtimeSnapshot) => void>();
  let snapshot: InboxRealtimeSnapshot = {
    connection: 'connecting',
    resyncGeneration: 0,
  };

  function publish(next: InboxRealtimeSnapshot) {
    snapshot = next;
    statusListeners.forEach((listener) => listener(snapshot));
  }

  return {
    getSnapshot: () => snapshot,
    listen(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    listenStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    emit(event) {
      if (event.accountId !== accountId) return;
      eventListeners.forEach((listener) => listener(event));
    },
    setConnection(connection, resync) {
      if (connection === snapshot.connection && !resync) return;
      publish({
        connection,
        resyncGeneration: snapshot.resyncGeneration + (resync ? 1 : 0),
      });
    },
    requestResync() {
      publish({
        connection: snapshot.connection,
        resyncGeneration: snapshot.resyncGeneration + 1,
      });
    },
    dispose() {
      eventListeners.clear();
      statusListeners.clear();
      snapshot = { connection: 'connecting', resyncGeneration: 0 };
    },
  };
}

const InboxRealtimeContext = createContext<InboxRealtimeFeed | null>(null);

function wasAway(state: AppStateStatus): boolean {
  return state === 'background' || state === 'inactive';
}

export function InboxRealtimeProvider({
  accountId,
  children,
  appState = AppState,
  subscribe = subscribeToInboxRealtime,
}: InboxRealtimeProviderProps): React.JSX.Element {
  const lifecycleGeneration = useRef(0);
  const feed = useMemo(() => createFeed(accountId), [accountId]);

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    let disposed = false;
    let cleanup: (() => Promise<void>) | null = null;
    let previousConnection: InboxConnectionState = 'connecting';
    let previousAppState = appState.currentState;

    const isCurrent = () =>
      !disposed && lifecycleGeneration.current === generation;

    const appStateSubscription = appState.addEventListener(
      'change',
      (nextState) => {
        if (!isCurrent()) return;
        if (wasAway(previousAppState) && nextState === 'active') {
          feed.requestResync();
        }
        previousAppState = nextState;
      }
    );

    void subscribe({
      accountId,
      onEvent(event) {
        if (isCurrent() && event.accountId === accountId) feed.emit(event);
      },
      onConnectionChange(connection) {
        if (!isCurrent()) return;
        const shouldResync =
          previousConnection === 'disconnected' && connection === 'connected';
        previousConnection = connection;
        feed.setConnection(connection, shouldResync);
      },
    })
      .then(async (unsubscribe) => {
        if (!isCurrent()) {
          await unsubscribe();
          return;
        }
        cleanup = unsubscribe;
      })
      .catch(() => {
        if (isCurrent()) feed.setConnection('disconnected', false);
      });

    return () => {
      disposed = true;
      lifecycleGeneration.current += 1;
      appStateSubscription.remove();
      feed.dispose();
      if (cleanup) void cleanup().catch(() => undefined);
    };
  }, [accountId, appState, feed, subscribe]);

  return (
    <InboxRealtimeContext.Provider value={feed}>
      {children}
    </InboxRealtimeContext.Provider>
  );
}

export function useInboxRealtimeFeed(): InboxRealtimeFeed {
  const feed = useContext(InboxRealtimeContext);
  if (!feed) {
    throw new Error(
      'useInboxRealtimeFeed must be used within InboxRealtimeProvider.'
    );
  }
  return feed;
}
