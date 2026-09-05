import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CONVERSATION_PAGE_SIZE,
  mobileConversationRepository,
  normalizeConversationSearch,
  type ConversationRepository,
  type ListConversationsInput,
} from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type { InboxConnectionState } from './inbox-realtime';
import type {
  ConversationCursor,
  ConversationFilter,
  InboxConversation,
} from './inbox-types';

const LOAD_ERROR = 'Could not load conversations';
const REFRESH_ERROR = 'Could not refresh conversations';
const MORE_ERROR = 'Could not load more conversations';

interface ConversationListState {
  accountId: string | null;
  scopeKey: string | null;
  items: InboxConversation[];
  cursor: ConversationCursor | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  refreshWarning: string | null;
  paginationError: string | null;
  unreadCount: number;
  refreshing: boolean;
}

export interface UseConversationListResult {
  items: InboxConversation[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  refreshWarning: string | null;
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
  if (first.lastMessageAt === null && second.lastMessageAt !== null) return 1;
  if (first.lastMessageAt !== null && second.lastMessageAt === null) return -1;
  const firstTime = first.lastMessageAt ?? first.createdAt;
  const secondTime = second.lastMessageAt ?? second.createdAt;
  if (firstTime !== secondTime) return secondTime.localeCompare(firstTime);
  return second.id.localeCompare(first.id);
}

function initialState(): ConversationListState {
  return {
    accountId: null,
    scopeKey: null,
    items: [],
    cursor: null,
    status: 'loading',
    error: null,
    refreshWarning: null,
    paginationError: null,
    unreadCount: 0,
    refreshing: true,
  };
}

/** Re-read only the loaded depth, in normal-sized keyset pages. Commit atomically. */
async function refreshLoadedRange(
  repository: ConversationRepository,
  input: Omit<ListConversationsInput, 'cursor' | 'limit'>,
  loadedCount: number,
  isCurrent: () => boolean
) {
  const target = Math.max(CONVERSATION_PAGE_SIZE, loadedCount);
  const items = new Map<string, InboxConversation>();
  let cursor: ConversationCursor | null = null;
  let remaining = target;
  // A changing dataset must never turn a refresh into an unbounded history scan.
  const maxPages = Math.ceil(target / CONVERSATION_PAGE_SIZE);
  for (let index = 0; index < maxPages; index += 1) {
    if (!isCurrent()) return null;
    const limit = Math.min(CONVERSATION_PAGE_SIZE, remaining);
    const page = await repository.list({
      ...input,
      cursor,
      ...(limit < CONVERSATION_PAGE_SIZE ? { limit } : {}),
    });
    if (!isCurrent()) return null;
    for (const item of page.items) items.set(item.id, item);
    if (
      page.nextCursor &&
      (page.items.length === 0 ||
        JSON.stringify(page.nextCursor) === JSON.stringify(cursor))
    )
      throw new Error(REFRESH_ERROR);
    cursor = page.nextCursor;
    remaining -= page.items.length;
    if (!cursor || remaining <= 0) break;
  }
  return {
    items: [...items.values()].sort(compareConversations),
    nextCursor: cursor,
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
  const scopeKey = `${accountId}:${filter}:${normalizedSearch}`;
  const activeAccountId = useRef(accountId);
  const latestState = useRef(state);
  const latestFilter = useRef(filter);
  const latestSearch = useRef(normalizedSearch);
  const listGeneration = useRef(0);
  const requestId = useRef(0);
  const nextPaginationOwner = useRef(0);
  const activePaginationOwner = useRef<number | null>(null);
  const knownConversationIds = useRef(new Set<string>());
  const hydrations = useRef(new Map<string, Promise<void>>());
  const snapshotVersion = useRef(0);
  const deletedConversationIds = useRef(new Set<string>());
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
    const currentState = latestState.current;
    const loadedCount =
      currentState.scopeKey === scopeKey ? currentState.items.length : 0;
    const isCurrent = () =>
      !cancelled &&
      mounted.current &&
      requestId.current === currentRequestId &&
      listGeneration.current === generation;
    activePaginationOwner.current = null;

    void (async () => {
      setLoadingMore(false);
      setState((previous) => ({
        accountId,
        scopeKey,
        items: previous.scopeKey === scopeKey ? previous.items : [],
        cursor: previous.scopeKey === scopeKey ? previous.cursor : null,
        status:
          previous.scopeKey === scopeKey && previous.status === 'ready'
            ? 'ready'
            : 'loading',
        error: null,
        refreshWarning: null,
        paginationError: null,
        unreadCount: previous.scopeKey === scopeKey ? previous.unreadCount : 0,
        refreshing: true,
      }));

      try {
        const [page, unreadCount] = await Promise.all([
          refreshLoadedRange(
            repository,
            { accountId, filter, search: normalizedSearch },
            loadedCount,
            isCurrent
          ),
          repository.unreadCount(accountId),
        ]);
        if (
          !page ||
          cancelled ||
          requestId.current !== currentRequestId ||
          listGeneration.current !== generation
        ) {
          return;
        }
        snapshotVersion.current += 1;
        setState({
          accountId,
          scopeKey,
          items: page.items.filter(
            (item) => !deletedConversationIds.current.has(item.id)
          ),
          cursor: page.nextCursor,
          status: 'ready',
          error: null,
          refreshWarning: null,
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
        setState((previous) => {
          if (previous.scopeKey === scopeKey && previous.status === 'ready') {
            return {
              ...previous,
              error: null,
              refreshWarning: REFRESH_ERROR,
              refreshing: false,
            };
          }
          return {
            accountId,
            scopeKey,
            items: [],
            cursor: null,
            status: 'error',
            error: LOAD_ERROR,
            refreshWarning: null,
            paginationError: null,
            unreadCount: 0,
            refreshing: false,
          };
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    filter,
    normalizedSearch,
    refreshNonce,
    repository,
    scopeKey,
    realtime,
  ]);

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
      const currentListGeneration = ++listGeneration.current;
      const currentFilter = latestFilter.current;
      const currentSearch = latestSearch.current;
      const currentScopeKey = `${currentAccountId}:${currentFilter}:${currentSearch}`;
      const currentRequestId = ++requestId.current;
      const currentState = latestState.current;
      const loadedCount =
        currentState.scopeKey === currentScopeKey
          ? currentState.items.length
          : 0;
      const isCurrent = () =>
        !disposed &&
        mounted.current &&
        activeAccountId.current === currentAccountId &&
        accountGeneration.current === currentAccountGeneration &&
        realtimeGeneration.current === currentRealtimeGeneration &&
        listGeneration.current === currentListGeneration &&
        requestId.current === currentRequestId;
      activePaginationOwner.current = null;
      if (mounted.current) setLoadingMore(false);
      if (mounted.current) {
        setState((previous) =>
          previous.scopeKey === currentScopeKey && previous.status === 'ready'
            ? {
                ...previous,
                refreshWarning: null,
                paginationError: null,
                refreshing: true,
              }
            : previous
        );
      }
      refreshInFlight = true;

      void (async () => {
        try {
          const [page, unreadCount] = await Promise.all([
            refreshLoadedRange(
              repository,
              {
                accountId: currentAccountId,
                filter: currentFilter,
                search: currentSearch,
              },
              loadedCount,
              isCurrent
            ),
            repository.unreadCount(currentAccountId),
          ]);
          if (
            !page ||
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
          snapshotVersion.current += 1;
          setState({
            accountId: currentAccountId,
            scopeKey: currentScopeKey,
            items: page.items.filter(
              (item) => !deletedConversationIds.current.has(item.id)
            ),
            cursor: page.nextCursor,
            status: 'ready',
            error: null,
            refreshWarning: null,
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
          setState((previous) => {
            if (
              previous.scopeKey === currentScopeKey &&
              previous.status === 'ready'
            ) {
              return {
                ...previous,
                error: null,
                refreshWarning: REFRESH_ERROR,
                refreshing: false,
              };
            }
            return {
              accountId: currentAccountId,
              scopeKey: currentScopeKey,
              items: [],
              cursor: null,
              status: 'error',
              error: LOAD_ERROR,
              refreshWarning: null,
              paginationError: null,
              unreadCount: 0,
              refreshing: false,
            };
          });
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

      if (event.table === 'conversations') {
        if (event.eventType === 'DELETE')
          deletedConversationIds.current.add(event.conversationId);
        if (event.eventType === 'INSERT')
          deletedConversationIds.current.delete(event.conversationId);
      }
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
      const currentSnapshotVersion = snapshotVersion.current;
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
            snapshotVersion.current !== currentSnapshotVersion ||
            deletedConversationIds.current.has(event.conversationId) ||
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
    // Keep the typed value even when only its spacing changes the display.
    setSearchState(value);
    if (normalizeConversationSearch(value) === latestSearch.current) return;
    listGeneration.current += 1;
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
      activePaginationOwner.current !== null ||
      current.status !== 'ready' ||
      current.refreshing ||
      current.accountId !== currentAccountId ||
      !current.cursor
    ) {
      return;
    }

    const paginationOwner = ++nextPaginationOwner.current;
    activePaginationOwner.current = paginationOwner;
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
            if (
              seen.has(item.id) ||
              deletedConversationIds.current.has(item.id)
            )
              return;
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
        if (activePaginationOwner.current === paginationOwner) {
          activePaginationOwner.current = null;
          if (mounted.current) setLoadingMore(false);
        }
      }
    })();
  }, [repository]);

  const stateMatchesScope = state.scopeKey === scopeKey;
  const items = stateMatchesScope ? state.items : [];
  return {
    items,
    status: stateMatchesScope ? state.status : 'loading',
    error: stateMatchesScope ? state.error : null,
    refreshWarning: stateMatchesScope ? state.refreshWarning : null,
    paginationError: stateMatchesScope ? state.paginationError : null,
    connection,
    filter,
    search,
    unreadCount: stateMatchesScope ? state.unreadCount : 0,
    refreshing: stateMatchesScope ? state.refreshing : true,
    loadingMore,
    hasMore: stateMatchesScope && state.cursor !== null,
    setFilter,
    setSearch,
    refresh,
    loadMore,
  };
}
