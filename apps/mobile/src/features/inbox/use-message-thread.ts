import { useCallback, useEffect, useRef, useState } from 'react';

import {
  canClearConversationUnread,
  type AccountRole,
} from '../../../../../src/lib/auth/roles';
import {
  mobileConversationRepository,
  type ConversationRepository,
} from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type { InboxConnectionState } from './inbox-realtime';
import {
  mobileMessageRepository,
  type MessageRepository,
} from './message-repository';
import type {
  InboxConversation,
  InboxMessage,
  MessageCursor,
} from './inbox-types';

const LOAD_ERROR = 'Could not load messages';
const PAGINATION_ERROR = 'Could not load older messages';
const UNREAD_ERROR = 'Could not clear unread messages';
const UNAVAILABLE_ERROR = 'Conversation is unavailable';

interface MessageThreadState {
  accountId: string | null;
  conversationId: string | null;
  conversation: InboxConversation | null;
  items: InboxMessage[];
  cursor: MessageCursor | null;
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  error: string | null;
  unreadWarning: string | null;
  paginationError: string | null;
  refreshing: boolean;
}

interface UnreadClear {
  scopeGeneration: number;
  feedGeneration: number;
  promise: Promise<void>;
}

type RealtimeMessageMutation =
  | { sequence: number; kind: 'delete' }
  | { sequence: number; kind: 'upsert'; item: InboxMessage };

interface MainRequestOwner {
  scopeGeneration: number;
  requestGeneration: number;
  feedGeneration: number;
}

export interface UseMessageThreadResult {
  conversation: InboxConversation | null;
  items: InboxMessage[];
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  error: string | null;
  unreadWarning: string | null;
  paginationError: string | null;
  connection: InboxConnectionState;
  refreshing: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  refresh(): void;
  loadOlder(): void;
}

export interface UseMessageThreadOptions {
  accountId: string;
  conversationId: string;
  role: AccountRole;
  conversations?: ConversationRepository;
  messages?: MessageRepository;
  realtime: InboxRealtimeFeed;
}

function initialState(): MessageThreadState {
  return {
    accountId: null,
    conversationId: null,
    conversation: null,
    items: [],
    cursor: null,
    status: 'loading',
    error: null,
    unreadWarning: null,
    paginationError: null,
    refreshing: true,
  };
}

function compareMessages(first: InboxMessage, second: InboxMessage): number {
  if (first.createdAt !== second.createdAt) {
    return first.createdAt.localeCompare(second.createdAt);
  }
  return first.id.localeCompare(second.id);
}

function uniqueChronological(items: InboxMessage[]): InboxMessage[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(compareMessages);
}

function reconcileMessageSnapshot(
  snapshotItems: InboxMessage[],
  currentItems: InboxMessage[],
  mutations: Map<string, RealtimeMessageMutation>,
  afterSequence: number
): InboxMessage[] {
  const byId = new Map<string, InboxMessage>();
  snapshotItems.forEach((item) => byId.set(item.id, item));
  currentItems.forEach((item) => byId.set(item.id, item));
  mutations.forEach((mutation, messageId) => {
    if (mutation.sequence <= afterSequence) return;
    if (mutation.kind === 'delete') {
      byId.delete(messageId);
    } else {
      byId.set(messageId, mutation.item);
    }
  });
  return [...byId.values()].sort(compareMessages);
}

function isUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message === UNAVAILABLE_ERROR;
}

export function useMessageThread({
  accountId,
  conversationId,
  role,
  conversations = mobileConversationRepository,
  messages = mobileMessageRepository,
  realtime,
}: UseMessageThreadOptions): UseMessageThreadResult {
  const [state, setState] = useState<MessageThreadState>(initialState);
  const [connection, setConnection] = useState<InboxConnectionState>(
    () => realtime.getSnapshot().connection
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const activeAccountId = useRef(accountId);
  const activeConversationId = useRef(conversationId);
  const activeRole = useRef(role);
  const activeScope = useRef(`${accountId}:${conversationId}`);
  const scopeGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const activeRealtime = useRef(realtime);
  const feedGeneration = useRef(0);
  const realtimeGeneration = useRef(0);
  const headerGeneration = useRef(0);
  const messageGenerations = useRef(new Map<string, number>());
  const hydrations = useRef(new Map<string, Promise<void>>());
  const messageMutations = useRef(new Map<string, RealtimeMessageMutation>());
  const mutationSequence = useRef(0);
  const latestState = useRef(state);
  const mounted = useRef(true);
  const nextPaginationOwner = useRef(0);
  const activePaginationOwner = useRef<number | null>(null);
  const unreadClear = useRef<UnreadClear | null>(null);
  const activeMainRequest = useRef<MainRequestOwner | null>(null);
  const feedReloadNeededScope = useRef<number | null>(null);
  const resyncGeneration = useRef(realtime.getSnapshot().resyncGeneration);

  const nextScope = `${accountId}:${conversationId}`;
  const scopeChanged = activeScope.current !== nextScope;
  if (scopeChanged) {
    activeScope.current = nextScope;
    scopeGeneration.current += 1;
    feedReloadNeededScope.current = null;
    requestGeneration.current += 1;
    headerGeneration.current += 1;
    activePaginationOwner.current = null;
    hydrations.current.clear();
    messageGenerations.current.clear();
    messageMutations.current.clear();
    mutationSequence.current = 0;
  }
  if (activeRealtime.current !== realtime) {
    const interruptedCurrentScopeLoad =
      activeMainRequest.current?.scopeGeneration === scopeGeneration.current;
    activeRealtime.current = realtime;
    feedGeneration.current += 1;
    if (
      !scopeChanged &&
      (interruptedCurrentScopeLoad ||
        feedReloadNeededScope.current === scopeGeneration.current)
    ) {
      feedReloadNeededScope.current = scopeGeneration.current;
    }
    requestGeneration.current += 1;
    headerGeneration.current += 1;
    activePaginationOwner.current = null;
    unreadClear.current = null;
    hydrations.current.clear();
    messageGenerations.current.clear();
    messageMutations.current.clear();
    mutationSequence.current = 0;
  }
  activeAccountId.current = accountId;
  activeConversationId.current = conversationId;
  activeRole.current = role;
  latestState.current = state;

  useEffect(() => {
    const activeHydrations = hydrations.current;
    const activeMutations = messageMutations.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      scopeGeneration.current += 1;
      requestGeneration.current += 1;
      headerGeneration.current += 1;
      activePaginationOwner.current = null;
      activeHydrations.clear();
      activeMutations.clear();
    };
  }, []);

  const clearUnread = useCallback(
    (
      clearAccountId: string,
      clearConversationId: string,
      clearScopeGeneration: number,
      clearFeedGeneration: number
    ) => {
      if (!canClearConversationUnread(activeRole.current)) return;
      if (
        unreadClear.current?.scopeGeneration === clearScopeGeneration &&
        unreadClear.current.feedGeneration === clearFeedGeneration
      ) {
        return;
      }

      const promise = conversations
        .markRead(clearAccountId, clearConversationId)
        .then(() => {
          if (
            mounted.current &&
            scopeGeneration.current === clearScopeGeneration &&
            feedGeneration.current === clearFeedGeneration &&
            activeAccountId.current === clearAccountId &&
            activeConversationId.current === clearConversationId
          ) {
            setState((previous) => ({ ...previous, unreadWarning: null }));
          }
        })
        .catch(() => {
          if (
            mounted.current &&
            scopeGeneration.current === clearScopeGeneration &&
            feedGeneration.current === clearFeedGeneration &&
            activeAccountId.current === clearAccountId &&
            activeConversationId.current === clearConversationId
          ) {
            setState((previous) => ({
              ...previous,
              unreadWarning: UNREAD_ERROR,
            }));
          }
        })
        .finally(() => {
          if (unreadClear.current?.promise === promise) {
            unreadClear.current = null;
          }
        });
      unreadClear.current = {
        scopeGeneration: clearScopeGeneration,
        feedGeneration: clearFeedGeneration,
        promise,
      };
    },
    [conversations]
  );

  useEffect(() => {
    const currentScopeGeneration = scopeGeneration.current;
    const currentRequestGeneration = ++requestGeneration.current;
    const currentFeedGeneration = feedGeneration.current;
    const snapshotMutationSequence = mutationSequence.current;
    const requestOwner: MainRequestOwner = {
      scopeGeneration: currentScopeGeneration,
      requestGeneration: currentRequestGeneration,
      feedGeneration: currentFeedGeneration,
    };
    activeMainRequest.current = requestOwner;
    if (feedReloadNeededScope.current === currentScopeGeneration) {
      feedReloadNeededScope.current = null;
    }
    let cancelled = false;

    void (async () => {
      activePaginationOwner.current = null;
      setLoadingOlder(false);
      setState((previous) => {
        const sameScope =
          previous.accountId === accountId &&
          previous.conversationId === conversationId;
        return {
          accountId,
          conversationId,
          conversation: sameScope ? previous.conversation : null,
          items: sameScope ? previous.items : [],
          cursor: sameScope ? previous.cursor : null,
          status:
            sameScope && previous.status === 'ready' ? 'ready' : 'loading',
          error: null,
          unreadWarning: null,
          paginationError: null,
          refreshing: true,
        };
      });

      try {
        const [verifiedConversation, page] = await Promise.all([
          conversations.get(accountId, conversationId),
          messages.list({ accountId, conversationId, cursor: null }),
        ]);
        if (
          cancelled ||
          !mounted.current ||
          scopeGeneration.current !== currentScopeGeneration ||
          requestGeneration.current !== currentRequestGeneration ||
          feedGeneration.current !== currentFeedGeneration ||
          activeAccountId.current !== accountId ||
          activeConversationId.current !== conversationId
        ) {
          return;
        }
        if (
          verifiedConversation.accountId !== accountId ||
          verifiedConversation.id !== conversationId
        ) {
          throw new Error(UNAVAILABLE_ERROR);
        }
        setState({
          accountId,
          conversationId,
          conversation: verifiedConversation,
          items: reconcileMessageSnapshot(
            page.items,
            [],
            messageMutations.current,
            snapshotMutationSequence
          ),
          cursor: page.nextCursor,
          status: 'ready',
          error: null,
          unreadWarning: null,
          paginationError: null,
          refreshing: false,
        });
        clearUnread(
          accountId,
          conversationId,
          currentScopeGeneration,
          currentFeedGeneration
        );
      } catch (error) {
        if (
          cancelled ||
          !mounted.current ||
          scopeGeneration.current !== currentScopeGeneration ||
          requestGeneration.current !== currentRequestGeneration ||
          feedGeneration.current !== currentFeedGeneration ||
          activeAccountId.current !== accountId ||
          activeConversationId.current !== conversationId
        ) {
          return;
        }
        setState({
          accountId,
          conversationId,
          conversation: null,
          items: [],
          cursor: null,
          status: isUnavailable(error) ? 'unavailable' : 'error',
          error: isUnavailable(error) ? null : LOAD_ERROR,
          unreadWarning: null,
          paginationError: null,
          refreshing: false,
        });
      } finally {
        if (activeMainRequest.current === requestOwner) {
          activeMainRequest.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    clearUnread,
    conversationId,
    conversations,
    messages,
    refreshNonce,
  ]);

  useEffect(() => {
    const currentRealtimeGeneration = ++realtimeGeneration.current;
    const currentFeedGeneration = feedGeneration.current;
    const currentScopeGeneration = scopeGeneration.current;
    const activeHydrations = hydrations.current;
    const activeMutations = messageMutations.current;
    const snapshot = realtime.getSnapshot();
    const previousResyncGeneration = resyncGeneration.current;
    const retryInterruptedLoad =
      currentFeedGeneration > 0 &&
      feedReloadNeededScope.current === currentScopeGeneration;
    const refreshForNewSnapshot =
      currentFeedGeneration > 0 &&
      snapshot.resyncGeneration > previousResyncGeneration;
    let disposed = false;

    const isCurrentListener = () =>
      !disposed &&
      mounted.current &&
      realtimeGeneration.current === currentRealtimeGeneration &&
      feedGeneration.current === currentFeedGeneration;

    const isCurrentScope = (
      eventAccountId: string,
      eventConversationId: string,
      eventScopeGeneration: number
    ) =>
      isCurrentListener() &&
      scopeGeneration.current === eventScopeGeneration &&
      activeAccountId.current === eventAccountId &&
      activeConversationId.current === eventConversationId;

    resyncGeneration.current = snapshot.resyncGeneration;
    void Promise.resolve().then(() => {
      if (isCurrentListener()) {
        setConnection(snapshot.connection);
        setLoadingOlder(false);
        const claimInterruptedReload =
          retryInterruptedLoad &&
          scopeGeneration.current === currentScopeGeneration &&
          feedReloadNeededScope.current === currentScopeGeneration;
        if (claimInterruptedReload) {
          feedReloadNeededScope.current = null;
        }
        if (claimInterruptedReload || refreshForNewSnapshot) {
          setRefreshNonce((value) => value + 1);
        }
      }
    });

    const eventCleanup = realtime.listen((event) => {
      if (!isCurrentListener()) return;
      if (
        event.accountId !== activeAccountId.current ||
        event.conversationId !== activeConversationId.current
      ) {
        return;
      }
      const eventAccountId = event.accountId;
      const eventConversationId = event.conversationId;
      const eventScopeGeneration = scopeGeneration.current;

      if (event.table === 'conversations') {
        const currentHeaderGeneration = ++headerGeneration.current;
        if (event.eventType === 'DELETE') {
          scopeGeneration.current += 1;
          requestGeneration.current += 1;
          activePaginationOwner.current = null;
          setLoadingOlder(false);
          activeHydrations.clear();
          activeMutations.clear();
          mutationSequence.current = 0;
          setState({
            accountId: eventAccountId,
            conversationId: eventConversationId,
            conversation: null,
            items: [],
            cursor: null,
            status: 'unavailable',
            error: null,
            unreadWarning: null,
            paginationError: null,
            refreshing: false,
          });
          return;
        }

        void (async () => {
          try {
            const item = await conversations.get(
              eventAccountId,
              eventConversationId
            );
            if (
              !isCurrentScope(
                eventAccountId,
                eventConversationId,
                eventScopeGeneration
              ) ||
              headerGeneration.current !== currentHeaderGeneration ||
              item.accountId !== eventAccountId ||
              item.id !== eventConversationId
            ) {
              return;
            }
            setState((previous) => {
              if (
                previous.accountId !== eventAccountId ||
                previous.conversationId !== eventConversationId ||
                previous.status !== 'ready'
              ) {
                return previous;
              }
              return { ...previous, conversation: item };
            });
          } catch {
            // A stale, deleted, or inaccessible header leaves current data intact.
          }
        })();
        return;
      }

      const messageId = event.messageId;
      if (event.eventType === 'DELETE') {
        activeMutations.set(messageId, {
          sequence: ++mutationSequence.current,
          kind: 'delete',
        });
        messageGenerations.current.set(
          messageId,
          (messageGenerations.current.get(messageId) ?? 0) + 1
        );
        activeHydrations.delete(messageId);
        setState((previous) => {
          if (
            previous.accountId !== eventAccountId ||
            previous.conversationId !== eventConversationId
          ) {
            return previous;
          }
          const items = previous.items.filter((item) => item.id !== messageId);
          return items.length === previous.items.length
            ? previous
            : { ...previous, items };
        });
        return;
      }

      const existing = latestState.current.items.some(
        (item) => item.id === messageId
      );
      if (
        (event.eventType === 'INSERT' && existing) ||
        (event.eventType === 'UPDATE' && !existing) ||
        activeHydrations.has(messageId)
      ) {
        return;
      }

      const messageGeneration = messageGenerations.current.get(messageId) ?? 0;
      const hydrate = (async () => {
        try {
          const item = await messages.get(
            eventAccountId,
            eventConversationId,
            messageId
          );
          if (
            !isCurrentScope(
              eventAccountId,
              eventConversationId,
              eventScopeGeneration
            ) ||
            (messageGenerations.current.get(messageId) ?? 0) !==
              messageGeneration ||
            item.conversationId !== eventConversationId ||
            item.id !== messageId
          ) {
            return;
          }
          const shouldClearUnread =
            event.eventType === 'INSERT' &&
            item.senderType === 'customer' &&
            latestState.current.accountId === eventAccountId &&
            latestState.current.conversationId === eventConversationId &&
            latestState.current.status === 'ready' &&
            !latestState.current.items.some(
              (message) => message.id === messageId
            );
          activeMutations.set(messageId, {
            sequence: ++mutationSequence.current,
            kind: 'upsert',
            item,
          });
          setState((previous) => {
            if (
              previous.accountId !== eventAccountId ||
              previous.conversationId !== eventConversationId ||
              previous.status !== 'ready'
            ) {
              return previous;
            }
            const index = previous.items.findIndex(
              (message) => message.id === messageId
            );
            if (event.eventType === 'UPDATE') {
              if (index < 0) return previous;
              const items = [...previous.items];
              items[index] = item;
              return { ...previous, items: items.sort(compareMessages) };
            }
            if (index >= 0) return previous;
            return {
              ...previous,
              items: uniqueChronological([...previous.items, item]),
            };
          });
          if (shouldClearUnread) {
            clearUnread(
              eventAccountId,
              eventConversationId,
              eventScopeGeneration,
              currentFeedGeneration
            );
          }
        } catch {
          // Missing, deleted, or inaccessible messages do not change the thread.
        }
      })();
      activeHydrations.set(messageId, hydrate);
      void hydrate.finally(() => {
        if (activeHydrations.get(messageId) === hydrate) {
          activeHydrations.delete(messageId);
        }
      });
    });

    const statusCleanup = realtime.listenStatus((nextSnapshot) => {
      if (!isCurrentListener()) return;
      setConnection(nextSnapshot.connection);
      if (nextSnapshot.resyncGeneration > resyncGeneration.current) {
        resyncGeneration.current = nextSnapshot.resyncGeneration;
        requestGeneration.current += 1;
        activePaginationOwner.current = null;
        setLoadingOlder(false);
        setRefreshNonce((value) => value + 1);
      }
    });

    return () => {
      disposed = true;
      realtimeGeneration.current += 1;
      activeHydrations.clear();
      activeMutations.clear();
      eventCleanup();
      statusCleanup();
    };
  }, [clearUnread, conversations, messages, realtime]);

  const refresh = useCallback(() => {
    requestGeneration.current += 1;
    activePaginationOwner.current = null;
    setLoadingOlder(false);
    setRefreshNonce((value) => value + 1);
  }, []);

  const loadOlder = useCallback(() => {
    const current = latestState.current;
    const currentAccountId = activeAccountId.current;
    const currentConversationId = activeConversationId.current;
    const currentScopeGeneration = scopeGeneration.current;
    const currentRequestGeneration = requestGeneration.current;
    const currentFeedGeneration = feedGeneration.current;
    const snapshotMutationSequence = mutationSequence.current;
    if (
      activePaginationOwner.current !== null ||
      current.accountId !== currentAccountId ||
      current.conversationId !== currentConversationId ||
      current.status !== 'ready' ||
      !current.cursor
    ) {
      return;
    }

    const paginationOwner = ++nextPaginationOwner.current;
    activePaginationOwner.current = paginationOwner;
    setLoadingOlder(true);
    setState((previous) => ({ ...previous, paginationError: null }));
    void (async () => {
      try {
        const page = await messages.list({
          accountId: currentAccountId,
          conversationId: currentConversationId,
          cursor: current.cursor,
        });
        if (
          !mounted.current ||
          scopeGeneration.current !== currentScopeGeneration ||
          requestGeneration.current !== currentRequestGeneration ||
          feedGeneration.current !== currentFeedGeneration ||
          activeAccountId.current !== currentAccountId ||
          activeConversationId.current !== currentConversationId
        ) {
          return;
        }
        setState((previous) => {
          if (
            previous.accountId !== currentAccountId ||
            previous.conversationId !== currentConversationId
          ) {
            return previous;
          }
          return {
            ...previous,
            items: reconcileMessageSnapshot(
              page.items,
              previous.items,
              messageMutations.current,
              snapshotMutationSequence
            ),
            cursor: page.nextCursor,
          };
        });
      } catch {
        if (
          mounted.current &&
          scopeGeneration.current === currentScopeGeneration &&
          requestGeneration.current === currentRequestGeneration &&
          feedGeneration.current === currentFeedGeneration &&
          activeAccountId.current === currentAccountId &&
          activeConversationId.current === currentConversationId
        ) {
          setState((previous) => ({
            ...previous,
            paginationError: PAGINATION_ERROR,
          }));
        }
      } finally {
        if (activePaginationOwner.current === paginationOwner) {
          activePaginationOwner.current = null;
          if (mounted.current) setLoadingOlder(false);
        }
      }
    })();
  }, [messages]);

  const stateMatchesScope =
    state.accountId === accountId && state.conversationId === conversationId;
  return {
    conversation: stateMatchesScope ? state.conversation : null,
    items: stateMatchesScope ? state.items : [],
    status: stateMatchesScope ? state.status : 'loading',
    error: stateMatchesScope ? state.error : null,
    unreadWarning: stateMatchesScope ? state.unreadWarning : null,
    paginationError: stateMatchesScope ? state.paginationError : null,
    connection,
    refreshing: stateMatchesScope ? state.refreshing : true,
    loadingOlder: stateMatchesScope ? loadingOlder : false,
    hasOlder: stateMatchesScope && state.cursor !== null,
    refresh,
    loadOlder,
  };
}
