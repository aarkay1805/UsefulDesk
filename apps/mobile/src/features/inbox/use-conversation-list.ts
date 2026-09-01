import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  mobileConversationRepository,
  normalizeConversationSearch,
  type ConversationRepository,
} from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type { InboxConnectionState } from './inbox-realtime';
import type {
  ConversationCursor,
  ConversationFilter,
  InboxConversation,
} from './inbox-types';

const LOAD_ERROR = 'Could not load conversations';
const MORE_ERROR = 'Could not load more conversations';

interface ConversationListState {
  accountId: string | null;
  items: InboxConversation[];
  cursor: ConversationCursor | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  paginationError: string | null;
  unreadCount: number;
  refreshing: boolean;
}

export interface UseConversationListResult {
  items: InboxConversation[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  paginationError: string | null;
  connection: InboxConnectionState;
  filter: ConversationFilter;
  search: string;
  unreadCount: number;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  setFilter(value: ConversationFilter): void;
  setSearch(value: string): void;
  refresh(): void;
  loadMore(): void;
}

export interface UseConversationListOptions {
  accountId: string;
  repository?: ConversationRepository;
  realtime: InboxRealtimeFeed;
}

function sameConversation(
  first: InboxConversation,
  second: InboxConversation
): boolean {
  return (
    first.id === second.id &&
    first.accountId === second.accountId &&
    first.contactId === second.contactId &&
    first.status === second.status &&
    first.assignedAgentId === second.assignedAgentId &&
    first.lastMessageText === second.lastMessageText &&
    first.lastMessageAt === second.lastMessageAt &&
    first.unreadCount === second.unreadCount &&
    first.createdAt === second.createdAt &&
    first.updatedAt === second.updatedAt &&
    first.isMember === second.isMember &&
    first.contact.id === second.contact.id &&
    first.contact.name === second.contact.name &&
    first.contact.phone === second.contact.phone &&
    first.contact.avatarUrl === second.contact.avatarUrl
  );
}

function compareConversations(
  first: InboxConversation,
  second: InboxConversation
) {
  const firstTime = first.lastMessageAt ?? first.createdAt;
  const secondTime = second.lastMessageAt ?? second.createdAt;
  if (firstTime !== secondTime) return secondTime.localeCompare(firstTime);
  return second.id.localeCompare(first.id);
}

function initialState(): ConversationListState {
  return {
    accountId: null,
    items: [],
    cursor: null,
    status: 'loading',
    error: null,
    paginationError: null,
    unreadCount: 0,
    refreshing: true,
  };
}

export function useConversationList({
  accountId,
  repository = mobileConversationRepository,
  realtime,
}: UseConversationListOptions): UseConversationListResult {
  const [filter, setFilterState] = useState<ConversationFilter>('all');
  const [search, setSearchState] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [state, setState] = useState<ConversationListState>(initialState);
  const [connection, setConnection] = useState<InboxConnectionState>(
    () => realtime.getSnapshot().connection
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const normalizedSearch = useMemo(
    () => normalizeConversationSearch(search),
    [search]
  );
  const activeAccountId = useRef(accountId);
  const latestState = useRef(state);
  const latestFilter = useRef(filter);
  const latestSearch = useRef(normalizedSearch);
  const listGeneration = useRef(0);
  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);
  const knownConversationIds = useRef(new Set<string>());
  const hydrations = useRef(new Map<string, Promise<void>>());
  const tombstoneGenerations = useRef(new Map<string, number>());
  const resyncGeneration = useRef(realtime.getSnapshot().resyncGeneration);
  const realtimeGeneration = useRef(0);
  const accountGeneration = useRef(0);
  const mounted = useRef(true);

  if (activeAccountId.current !== accountId) {
    accountGeneration.current += 1;
  }
  activeAccountId.current = accountId;
  latestState.current = state;
  latestFilter.current = filter;
  latestSearch.current = normalizedSearch;

  useEffect(() => {
    knownConversationIds.current = new Set(state.items.map((item) => item.id));
  }, [state.items]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    const generation = ++listGeneration.current;
    const currentRequestId = ++requestId.current;
    let cancelled = false;

    void (async () => {
      setState((previous) => ({
        ...previous,
        cursor: null,
        status: 'loading',
        error: null,
        paginationError: null,
        refreshing: true,
      }));

      try {
        const [page, unreadCount] = await Promise.all([
          repository.list({
            accountId,
            filter,
            search: normalizedSearch,
            cursor: null,
          }),
          repository.unreadCount(accountId),
        ]);
        if (
          cancelled ||
          requestId.current !== currentRequestId ||
          listGeneration.current !== generation
        ) {
          return;
        }
        setState({
          accountId,
          items: page.items,
          cursor: page.nextCursor,
          status: 'ready',
          error: null,
          paginationError: null,
          unreadCount,
          refreshing: false,
        });
      } catch {
        if (
          cancelled ||
          requestId.current !== currentRequestId ||
          listGeneration.current !== generation
        ) {
          return;
        }
        setState((previous) => ({
          accountId,
          items: [],
          cursor: null,
          status: 'error',
          error: LOAD_ERROR,
          paginationError: null,
          unreadCount: 0,
          refreshing: false,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, filter, normalizedSearch, refreshNonce, repository]);

  useEffect(() => {
    const currentRealtimeGeneration = ++realtimeGeneration.current;
    const activeHydrations = hydrations.current;
    const snapshot = realtime.getSnapshot();
    let disposed = false;
    let refreshInFlight = false;
    let refreshPending = false;

    const refreshActiveQuery = () => {
      if (disposed || refreshInFlight) {
        refreshPending = !disposed;
        return;
      }
      const currentAccountId = activeAccountId.current;
      const currentAccountGeneration = accountGeneration.current;
      const currentListGeneration = listGeneration.current;
      const currentFilter = latestFilter.current;
      const currentSearch = latestSearch.current;
      const currentRequestId = ++requestId.current;
      refreshInFlight = true;

      void (async () => {
        try {
          const [page, unreadCount] = await Promise.all([
            repository.list({
              accountId: currentAccountId,
              filter: currentFilter,
              search: currentSearch,
              cursor: null,
            }),
            repository.unreadCount(currentAccountId),
          ]);
          if (
            disposed ||
            !mounted.current ||
            activeAccountId.current !== currentAccountId ||
            accountGeneration.current !== currentAccountGeneration ||
            realtimeGeneration.current !== currentRealtimeGeneration ||
            listGeneration.current !== currentListGeneration ||
            requestId.current !== currentRequestId
          ) {
            return;
          }
          setState({
            accountId: currentAccountId,
            items: page.items,
            cursor: page.nextCursor,
            status: 'ready',
            error: null,
            paginationError: null,
            unreadCount,
            refreshing: false,
          });
        } catch {
          if (
            disposed ||
            !mounted.current ||
            activeAccountId.current !== currentAccountId ||
            accountGeneration.current !== currentAccountGeneration ||
            realtimeGeneration.current !== currentRealtimeGeneration ||
            listGeneration.current !== currentListGeneration ||
            requestId.current !== currentRequestId
          ) {
            return;
          }
          setState((previous) => ({
            ...previous,
            error: LOAD_ERROR,
            refreshing: false,
          }));
        } finally {
          refreshInFlight = false;
          if (refreshPending) {
            refreshPending = false;
            refreshActiveQuery();
          }
        }
      })();
    };

    resyncGeneration.current = snapshot.resyncGeneration;
    setConnection(snapshot.connection);
    const eventCleanup = realtime.listen((event) => {
      const currentAccountId = activeAccountId.current;
      if (event.accountId !== currentAccountId) return;

      refreshActiveQuery();

      if (event.table === 'conversations' && event.eventType === 'DELETE') {
        tombstoneGenerations.current.set(
          event.conversationId,
          (tombstoneGenerations.current.get(event.conversationId) ?? 0) + 1
        );
        activeHydrations.delete(event.conversationId);
        setState((previous) => {
          if (previous.accountId !== currentAccountId) return previous;
          const items = previous.items.filter(
            (item) => item.id !== event.conversationId
          );
          return items.length === previous.items.length
            ? previous
            : { ...previous, items };
        });
        return;
      }

      if (activeHydrations.has(event.conversationId)) return;
      const currentAccountGeneration = accountGeneration.current;
      const currentListGeneration = listGeneration.current;
      const currentFilter = latestFilter.current;
      const currentSearch = latestSearch.current;
      const tombstoneGeneration =
        tombstoneGenerations.current.get(event.conversationId) ?? 0;
      const hydrate = (async () => {
        try {
          const item = await repository.get(
            currentAccountId,
            event.conversationId
          );
          if (
            !mounted.current ||
            activeAccountId.current !== currentAccountId ||
            accountGeneration.current !== currentAccountGeneration ||
            realtimeGeneration.current !== currentRealtimeGeneration ||
            listGeneration.current !== currentListGeneration ||
            (tombstoneGenerations.current.get(event.conversationId) ?? 0) !==
              tombstoneGeneration ||
            item.accountId !== currentAccountId
          ) {
            return;
          }
          if (currentFilter !== 'all' || currentSearch) return;
          setState((previous) => {
            if (previous.accountId !== currentAccountId) return previous;
            const index = previous.items.findIndex((row) => row.id === item.id);
            if (index >= 0) {
              if (sameConversation(previous.items[index], item))
                return previous;
              const items = [...previous.items];
              items[index] = item;
              return { ...previous, items: items.sort(compareConversations) };
            }
            return {
              ...previous,
              items: [...previous.items, item].sort(compareConversations),
            };
          });
        } catch {
          // A deleted or inaccessible conversation must not change local state.
        }
      })();
      activeHydrations.set(event.conversationId, hydrate);
      void hydrate.finally(() => {
        if (activeHydrations.get(event.conversationId) === hydrate) {
          activeHydrations.delete(event.conversationId);
        }
      });
    });
    const statusCleanup = realtime.listenStatus((snapshot) => {
      setConnection(snapshot.connection);
      if (snapshot.resyncGeneration > resyncGeneration.current) {
        resyncGeneration.current = snapshot.resyncGeneration;
        setRefreshNonce((value) => value + 1);
      }
    });

    return () => {
      disposed = true;
      refreshPending = false;
      realtimeGeneration.current += 1;
      activeHydrations.clear();
      eventCleanup();
      statusCleanup();
    };
  }, [realtime, repository]);

  const setFilter = useCallback((value: ConversationFilter) => {
    if (value === latestFilter.current) return;
    listGeneration.current += 1;
    setFilterState(value);
    setState((previous) => ({
      ...previous,
      cursor: null,
      paginationError: null,
    }));
  }, []);

  const setSearch = useCallback((value: string) => {
    if (normalizeConversationSearch(value) === latestSearch.current) return;
    listGeneration.current += 1;
    setSearchState(value);
    setState((previous) => ({
      ...previous,
      cursor: null,
      paginationError: null,
    }));
  }, []);

  const refresh = useCallback(() => {
    listGeneration.current += 1;
    setRefreshNonce((value) => value + 1);
  }, []);

  const loadMore = useCallback(() => {
    const current = latestState.current;
    const generation = listGeneration.current;
    const currentAccountId = activeAccountId.current;
    if (
      loadingMoreRef.current ||
      current.status !== 'ready' ||
      current.accountId !== currentAccountId ||
      !current.cursor
    ) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setState((previous) => ({ ...previous, paginationError: null }));
    void (async () => {
      try {
        const page = await repository.list({
          accountId: currentAccountId,
          filter: latestFilter.current,
          search: latestSearch.current,
          cursor: current.cursor,
        });
        if (
          activeAccountId.current !== currentAccountId ||
          listGeneration.current !== generation
        ) {
          return;
        }
        setState((previous) => {
          if (previous.accountId !== currentAccountId) return previous;
          const seen = new Set(previous.items.map((item) => item.id));
          const items = [...previous.items];
          page.items.forEach((item) => {
            if (seen.has(item.id)) return;
            seen.add(item.id);
            items.push(item);
          });
          return { ...previous, items, cursor: page.nextCursor };
        });
      } catch {
        if (
          activeAccountId.current === currentAccountId &&
          listGeneration.current === generation
        ) {
          setState((previous) => ({
            ...previous,
            status: 'ready',
            paginationError: MORE_ERROR,
          }));
        }
      } finally {
        loadingMoreRef.current = false;
        if (mounted.current) setLoadingMore(false);
      }
    })();
  }, [repository]);

  const items = state.accountId === accountId ? state.items : [];
  return {
    items,
    status: state.status,
    error: state.error,
    paginationError: state.paginationError,
    connection,
    filter,
    search,
    unreadCount: state.accountId === accountId ? state.unreadCount : 0,
    refreshing: state.refreshing,
    loadingMore,
    hasMore: state.accountId === accountId && state.cursor !== null,
    setFilter,
    setSearch,
    refresh,
    loadMore,
  };
}
