import { useCallback, useEffect, useRef, useState } from 'react';

import {
  canClearConversationUnread,
  canSendMessages,
  type AccountRole,
} from '../../../../../src/lib/auth/roles';
import {
  mobileConversationRepository,
  type ConversationRepository,
} from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type {
  InboxConnectionState,
  InboxRealtimeEvent,
} from './inbox-realtime';
import { isStrictIsoTimestamp } from './inbox-normalizers';
import {
  mobileMessageRepository,
  type SessionWindowMessageRepository,
} from './message-repository';
import {
  appendOptimisticText,
  applyRealtimeMessage,
  applySendAcknowledgement,
  emptyOutboundThreadState,
  hasMessageIdentity,
  hasTemporaryAliasForMessage,
  markOptimisticFailed,
  messageForTemporaryId,
  type OutboundThreadState,
} from './outbound-message-state';
import {
  describeMobileSendFailure,
  sendConversationMessage,
  type MobileSendDependencies,
  type MobileSendInput,
  type MobileSendResult,
} from './send-message-client';
import type {
  ConnectionReadiness,
  InboxConversation,
  InboxMessage,
  MessageCursor,
  NativeTemplate,
} from './inbox-types';
import {
  mobileTemplateRepository,
  type TemplateRepository,
} from './template-repository';

const LOAD_ERROR = 'Could not load messages';
const REFRESH_ERROR = 'Could not refresh messages';
const PAGINATION_ERROR = 'Could not load older messages';
const UNREAD_ERROR = 'Could not clear unread messages';
const UNAVAILABLE_ERROR = 'Conversation is unavailable';

interface MessageThreadState {
  accountId: string | null;
  conversationId: string | null;
  conversation: InboxConversation | null;
  thread: OutboundThreadState;
  cursor: MessageCursor | null;
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  error: string | null;
  refreshWarning: string | null;
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

export interface ConversationSendReadiness {
  status: 'hidden' | 'loading' | 'ready' | 'error';
  latestInboundAt: string | null;
  templates: NativeTemplate[];
  connectionReadiness: ConnectionReadiness | null;
  templateReadiness: {
    hasLocalTemplates: boolean;
    contractReady: boolean;
  } | null;
}

interface OwnedConversationSendReadiness extends ConversationSendReadiness {
  accountId: string | null;
  conversationId: string | null;
  feedGeneration: number;
}

export interface UseMessageThreadResult {
  conversation: InboxConversation | null;
  items: InboxMessage[];
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  error: string | null;
  refreshWarning: string | null;
  unreadWarning: string | null;
  paginationError: string | null;
  connection: InboxConnectionState;
  refreshing: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  sendReadiness: ConversationSendReadiness;
  refresh(): void;
  loadOlder(): void;
  sendText(draft: string): Promise<SendAttemptResult>;
  retryText(temporaryId: string): Promise<SendAttemptResult>;
}

export type SendAttemptResult =
  | { temporaryId: string; status: 'sent' }
  | {
      temporaryId: string;
      status: 'failed';
      safeToRetry: boolean;
      message: string;
    };

export interface MessageThreadOutboundDependencies {
  senderId: string;
  recoverUnauthorizedSession(): Promise<void>;
  sendMessage?: (
    input: MobileSendInput,
    dependencies: MobileSendDependencies
  ) => Promise<MobileSendResult>;
  createTemporaryId?: () => string;
  now?: () => string;
}

export interface UseMessageThreadOptions {
  accountId: string;
  conversationId: string;
  role: AccountRole;
  conversations?: ConversationRepository;
  messages?: SessionWindowMessageRepository;
  templates?: TemplateRepository;
  realtime: InboxRealtimeFeed;
  outbound?: MessageThreadOutboundDependencies;
}

function initialState(): MessageThreadState {
  return {
    accountId: null,
    conversationId: null,
    conversation: null,
    thread: emptyOutboundThreadState(),
    cursor: null,
    status: 'loading',
    error: null,
    refreshWarning: null,
    unreadWarning: null,
    paginationError: null,
    refreshing: true,
  };
}

function emptySendReadiness(
  status: ConversationSendReadiness['status'],
  accountId: string | null = null,
  conversationId: string | null = null,
  feedGeneration = -1
): OwnedConversationSendReadiness {
  return {
    accountId,
    conversationId,
    feedGeneration,
    status,
    latestInboundAt: null,
    templates: [],
    connectionReadiness: null,
    templateReadiness: null,
  };
}

function publicSendReadiness(
  readiness: OwnedConversationSendReadiness
): ConversationSendReadiness {
  return {
    status: readiness.status,
    latestInboundAt: readiness.latestInboundAt,
    templates: readiness.templates,
    connectionReadiness: readiness.connectionReadiness,
    templateReadiness: readiness.templateReadiness,
  };
}

function readinessResultIsConsistent(
  latestInboundAt: string | null,
  templates: NativeTemplate[],
  connectionReadiness: ConnectionReadiness
): boolean {
  if (
    (latestInboundAt !== null && !isStrictIsoTimestamp(latestInboundAt)) ||
    !Array.isArray(templates)
  ) {
    return false;
  }
  const templatesAreSendable = templates.every(
    (template) =>
      template !== null &&
      typeof template === 'object' &&
      template.status === 'APPROVED' &&
      template.parameterFormat === 'POSITIONAL' &&
      template.providerMissingSince === null &&
      template.providerComponentsSyncRequiredAt === null &&
      template.headerMediaUrl === null
  );
  const connectionIsConsistent =
    connectionReadiness !== null &&
    typeof connectionReadiness === 'object' &&
    connectionReadiness.ready ===
      (connectionReadiness.status === 'connected') &&
    (connectionReadiness.ready
      ? connectionReadiness.reason === null
      : typeof connectionReadiness.reason === 'string');
  return templatesAreSendable && connectionIsConsistent;
}

function compareMessages(first: InboxMessage, second: InboxMessage): number {
  if (first.createdAt !== second.createdAt) {
    return first.createdAt.localeCompare(second.createdAt);
  }
  return first.id.localeCompare(second.id);
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
  templates = mobileTemplateRepository,
  realtime,
  outbound,
}: UseMessageThreadOptions): UseMessageThreadResult {
  const [state, setState] = useState<MessageThreadState>(initialState);
  const [connection, setConnection] = useState<InboxConnectionState>(
    () => realtime.getSnapshot().connection
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendReadiness, setSendReadiness] =
    useState<OwnedConversationSendReadiness>(() =>
      emptySendReadiness('loading')
    );
  const activeAccountId = useRef(accountId);
  const activeConversationId = useRef(conversationId);
  const activeRole = useRef(role);
  const activeOutbound = useRef(outbound);
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
  const nextSendAttempt = useRef(0);
  const activeRetries = useRef(new Map<string, Promise<SendAttemptResult>>());
  const activeMainRequest = useRef<MainRequestOwner | null>(null);
  const feedReloadNeededScope = useRef<number | null>(null);
  const acknowledgedResyncGeneration = useRef(
    realtime.getSnapshot().resyncGeneration
  );

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
    activeRetries.current.clear();
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
    activeRetries.current.clear();
  }
  activeAccountId.current = accountId;
  activeConversationId.current = conversationId;
  activeRole.current = role;
  activeOutbound.current = outbound;
  latestState.current = state;

  useEffect(() => {
    const activeHydrations = hydrations.current;
    const activeMutations = messageMutations.current;
    const mountedRetries = activeRetries.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      scopeGeneration.current += 1;
      requestGeneration.current += 1;
      headerGeneration.current += 1;
      activePaginationOwner.current = null;
      activeHydrations.clear();
      activeMutations.clear();
      mountedRetries.clear();
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
          thread: sameScope ? previous.thread : emptyOutboundThreadState(),
          cursor: sameScope ? previous.cursor : null,
          status:
            sameScope && previous.status === 'ready' ? 'ready' : 'loading',
          error: null,
          refreshWarning: null,
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
          thread: emptyOutboundThreadState(
            reconcileMessageSnapshot(
              page.items,
              [],
              messageMutations.current,
              snapshotMutationSequence
            )
          ),
          cursor: page.nextCursor,
          status: 'ready',
          error: null,
          refreshWarning: null,
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
        const unavailable = isUnavailable(error);
        setState((previous) => {
          const sameReadyScope =
            previous.accountId === accountId &&
            previous.conversationId === conversationId &&
            previous.status === 'ready' &&
            previous.conversation !== null;
          if (!unavailable && sameReadyScope) {
            return {
              ...previous,
              error: null,
              refreshWarning: REFRESH_ERROR,
              refreshing: false,
            };
          }
          return {
            accountId,
            conversationId,
            conversation: null,
            thread: emptyOutboundThreadState(),
            cursor: null,
            status: unavailable ? 'unavailable' : 'error',
            error: unavailable ? null : LOAD_ERROR,
            refreshWarning: null,
            unreadWarning: null,
            paginationError: null,
            refreshing: false,
          };
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
    const readinessAccountId = accountId;
    const readinessConversationId = conversationId;
    const readinessScopeGeneration = scopeGeneration.current;
    const readinessRequestGeneration = requestGeneration.current;
    const readinessFeedGeneration = feedGeneration.current;
    let cancelled = false;

    if (!canSendMessages(role)) {
      setSendReadiness(
        emptySendReadiness(
          'hidden',
          readinessAccountId,
          readinessConversationId,
          readinessFeedGeneration
        )
      );
      return () => {
        cancelled = true;
      };
    }

    setSendReadiness(
      emptySendReadiness(
        'loading',
        readinessAccountId,
        readinessConversationId,
        readinessFeedGeneration
      )
    );

    const isCurrentReadinessOwner = () =>
      !cancelled &&
      mounted.current &&
      scopeGeneration.current === readinessScopeGeneration &&
      requestGeneration.current === readinessRequestGeneration &&
      feedGeneration.current === readinessFeedGeneration &&
      activeAccountId.current === readinessAccountId &&
      activeConversationId.current === readinessConversationId;

    void (async () => {
      try {
        const [latestInboundAt, sendableTemplates, connectionReadiness] =
          await Promise.all([
            messages.getLatestCustomerMessageAt(
              readinessAccountId,
              readinessConversationId
            ),
            templates.listSendableTemplates(readinessAccountId),
            templates.getWhatsAppConnectionReadiness(readinessAccountId),
          ]);
        if (!isCurrentReadinessOwner()) return;
        if (
          !readinessResultIsConsistent(
            latestInboundAt,
            sendableTemplates,
            connectionReadiness
          )
        ) {
          throw new Error('Send readiness is inconsistent');
        }
        setSendReadiness({
          accountId: readinessAccountId,
          conversationId: readinessConversationId,
          feedGeneration: readinessFeedGeneration,
          status: 'ready',
          latestInboundAt,
          templates: sendableTemplates,
          connectionReadiness,
          templateReadiness: {
            hasLocalTemplates: sendableTemplates.length > 0,
            contractReady: sendableTemplates.length > 0,
          },
        });
      } catch {
        if (!isCurrentReadinessOwner()) return;
        setSendReadiness(
          emptySendReadiness(
            'error',
            readinessAccountId,
            readinessConversationId,
            readinessFeedGeneration
          )
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    conversationId,
    messages,
    realtime,
    refreshNonce,
    role,
    templates,
  ]);

  useEffect(() => {
    const currentRealtimeGeneration = ++realtimeGeneration.current;
    const currentFeedGeneration = feedGeneration.current;
    const currentScopeGeneration = scopeGeneration.current;
    const activeHydrations = hydrations.current;
    const activeMutations = messageMutations.current;
    const snapshot = realtime.getSnapshot();
    const retryInterruptedLoad =
      currentFeedGeneration > 0 &&
      feedReloadNeededScope.current === currentScopeGeneration;
    const refreshForNewSnapshot =
      currentFeedGeneration > 0 &&
      snapshot.resyncGeneration > acknowledgedResyncGeneration.current;
    const pendingMessageUpdates = new Map<string, InboxRealtimeEvent>();
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
        const claimResyncRefresh =
          refreshForNewSnapshot &&
          snapshot.resyncGeneration > acknowledgedResyncGeneration.current;
        if (claimResyncRefresh) {
          acknowledgedResyncGeneration.current = snapshot.resyncGeneration;
        }
        if (claimInterruptedReload || claimResyncRefresh) {
          setRefreshNonce((value) => value + 1);
        }
      }
    });

    const handleRealtimeEvent = (
      event: InboxRealtimeEvent,
      allowMissingUpdate = false
    ) => {
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
          pendingMessageUpdates.clear();
          activeMutations.clear();
          mutationSequence.current = 0;
          setState({
            accountId: eventAccountId,
            conversationId: eventConversationId,
            conversation: null,
            thread: emptyOutboundThreadState(),
            cursor: null,
            status: 'unavailable',
            error: null,
            refreshWarning: null,
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
        pendingMessageUpdates.delete(messageId);
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
          const messages = previous.thread.messages.filter(
            (item) => item.id !== messageId
          );
          return messages.length === previous.thread.messages.length
            ? previous
            : {
                ...previous,
                thread: { ...previous.thread, messages },
              };
        });
        return;
      }

      const existing = hasMessageIdentity(
        latestState.current.thread,
        messageId
      );
      const optimisticOutbound = hasTemporaryAliasForMessage(
        latestState.current.thread,
        messageId
      );
      if (activeHydrations.has(messageId)) {
        if (event.eventType === 'UPDATE') {
          pendingMessageUpdates.set(messageId, event);
        }
        return;
      }
      if (
        (event.eventType === 'INSERT' && existing && !optimisticOutbound) ||
        (event.eventType === 'UPDATE' && !existing && !allowMissingUpdate)
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
            !latestState.current.thread.messages.some(
              (message) => message.id === messageId
            );
          activeMutations.set(messageId, {
            sequence: ++mutationSequence.current,
            kind: 'upsert',
            item,
          });
          if (event.eventType === 'INSERT' && item.senderType === 'customer') {
            setSendReadiness((previous) => {
              if (
                previous.status !== 'ready' ||
                previous.accountId !== eventAccountId ||
                previous.conversationId !== eventConversationId ||
                previous.feedGeneration !== currentFeedGeneration
              ) {
                return previous;
              }
              const previousInboundMs = previous.latestInboundAt
                ? Date.parse(previous.latestInboundAt)
                : Number.NEGATIVE_INFINITY;
              const insertedInboundMs = Date.parse(item.createdAt);
              return Number.isFinite(insertedInboundMs) &&
                insertedInboundMs > previousInboundMs
                ? { ...previous, latestInboundAt: item.createdAt }
                : previous;
            });
          }
          setState((previous) => {
            if (
              previous.accountId !== eventAccountId ||
              previous.conversationId !== eventConversationId ||
              previous.status !== 'ready'
            ) {
              return previous;
            }
            if (event.eventType === 'UPDATE') {
              if (
                !allowMissingUpdate &&
                !hasMessageIdentity(previous.thread, messageId)
              ) {
                return previous;
              }
              return {
                ...previous,
                thread: applyRealtimeMessage(previous.thread, item),
              };
            }
            return {
              ...previous,
              thread: applyRealtimeMessage(previous.thread, item),
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
          const pendingUpdate = pendingMessageUpdates.get(messageId);
          if (pendingUpdate) {
            pendingMessageUpdates.delete(messageId);
            handleRealtimeEvent(pendingUpdate, true);
          }
        }
      });
    };
    const eventCleanup = realtime.listen((event) => handleRealtimeEvent(event));

    const statusCleanup = realtime.listenStatus((nextSnapshot) => {
      if (!isCurrentListener()) return;
      setConnection(nextSnapshot.connection);
      if (
        nextSnapshot.resyncGeneration > acknowledgedResyncGeneration.current
      ) {
        acknowledgedResyncGeneration.current = nextSnapshot.resyncGeneration;
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
      pendingMessageUpdates.clear();
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

  const performTextSend = useCallback(
    async (
      temporaryId: string,
      attemptId: string,
      text: string,
      createdAt: string,
      dependencies: MessageThreadOutboundDependencies
    ): Promise<SendAttemptResult> => {
      const sendAccountId = activeAccountId.current;
      const sendConversationId = activeConversationId.current;
      const sendScopeGeneration = scopeGeneration.current;
      const sendFeedGeneration = feedGeneration.current;

      setState((previous) => {
        if (
          previous.accountId !== sendAccountId ||
          previous.conversationId !== sendConversationId ||
          previous.status !== 'ready'
        ) {
          return previous;
        }
        return {
          ...previous,
          thread: appendOptimisticText(previous.thread, {
            temporaryId,
            attemptId,
            conversationId: sendConversationId,
            senderId: dependencies.senderId,
            text,
            createdAt,
          }),
        };
      });

      const isCurrentSend = () =>
        mounted.current &&
        scopeGeneration.current === sendScopeGeneration &&
        feedGeneration.current === sendFeedGeneration &&
        activeAccountId.current === sendAccountId &&
        activeConversationId.current === sendConversationId;

      try {
        const acknowledgement = await (
          dependencies.sendMessage ?? sendConversationMessage
        )(
          {
            kind: 'text',
            accountId: sendAccountId,
            conversationId: sendConversationId,
            text,
          },
          {
            recoverUnauthorizedSession: dependencies.recoverUnauthorizedSession,
          }
        );
        if (isCurrentSend()) {
          setState((previous) => {
            if (
              previous.accountId !== sendAccountId ||
              previous.conversationId !== sendConversationId
            ) {
              return previous;
            }
            return {
              ...previous,
              thread: applySendAcknowledgement(previous.thread, {
                temporaryId,
                messageId: acknowledgement.messageId,
                whatsappMessageId: acknowledgement.whatsappMessageId,
              }),
            };
          });
        }
        return { temporaryId, status: 'sent' };
      } catch (error) {
        const failure = describeMobileSendFailure(error);
        if (isCurrentSend()) {
          setState((previous) => {
            if (
              previous.accountId !== sendAccountId ||
              previous.conversationId !== sendConversationId
            ) {
              return previous;
            }
            return {
              ...previous,
              thread: markOptimisticFailed(
                previous.thread,
                temporaryId,
                failure.message,
                attemptId,
                failure.safeToRetry
              ),
            };
          });
        }
        return { temporaryId, status: 'failed', ...failure };
      }
    },
    []
  );

  const sendText = useCallback(
    (draft: string): Promise<SendAttemptResult> => {
      const dependencies = activeOutbound.current;
      if (!dependencies) {
        return Promise.reject(
          new Error('Outbound message dependencies are unavailable')
        );
      }
      const temporaryId =
        dependencies.createTemporaryId?.() ??
        `temp:${globalThis.crypto.randomUUID()}`;
      return performTextSend(
        temporaryId,
        `attempt:${++nextSendAttempt.current}`,
        draft.trim(),
        dependencies.now?.() ?? new Date().toISOString(),
        dependencies
      );
    },
    [performTextSend]
  );

  const retryText = useCallback(
    (temporaryId: string): Promise<SendAttemptResult> => {
      const dependencies = activeOutbound.current;
      if (!dependencies) {
        return Promise.reject(
          new Error('Outbound message dependencies are unavailable')
        );
      }
      const activeRetry = activeRetries.current.get(temporaryId);
      if (activeRetry) return activeRetry;
      const current = latestState.current.thread;
      const candidate = messageForTemporaryId(current, temporaryId);
      const failed = candidate?.status === 'failed' ? candidate : null;
      if (!failed?.contentText || failed.safeToRetry !== true) {
        return Promise.resolve({
          temporaryId,
          status: 'failed',
          safeToRetry: false,
          message:
            failed?.providerErrorTitle ??
            'Delivery could not be confirmed. Check the conversation before sending again.',
        });
      }
      const retry = performTextSend(
        temporaryId,
        `attempt:${++nextSendAttempt.current}`,
        failed.contentText,
        failed.createdAt,
        dependencies
      );
      activeRetries.current.set(temporaryId, retry);
      void retry.finally(() => {
        if (activeRetries.current.get(temporaryId) === retry) {
          activeRetries.current.delete(temporaryId);
        }
      });
      return retry;
    },
    [performTextSend]
  );

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
      current.refreshing ||
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
            thread: {
              ...previous.thread,
              messages: reconcileMessageSnapshot(
                page.items,
                previous.thread.messages,
                messageMutations.current,
                snapshotMutationSequence
              ),
            },
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
  const sendReadinessMatchesOwner =
    sendReadiness.accountId === accountId &&
    sendReadiness.conversationId === conversationId &&
    sendReadiness.feedGeneration === feedGeneration.current;
  const visibleSendReadiness = !canSendMessages(role)
    ? emptySendReadiness(
        'hidden',
        accountId,
        conversationId,
        feedGeneration.current
      )
    : sendReadinessMatchesOwner
      ? sendReadiness
      : emptySendReadiness(
          'loading',
          accountId,
          conversationId,
          feedGeneration.current
        );
  return {
    conversation: stateMatchesScope ? state.conversation : null,
    items: stateMatchesScope ? state.thread.messages : [],
    status: stateMatchesScope ? state.status : 'loading',
    error: stateMatchesScope ? state.error : null,
    refreshWarning: stateMatchesScope ? state.refreshWarning : null,
    unreadWarning: stateMatchesScope ? state.unreadWarning : null,
    paginationError: stateMatchesScope ? state.paginationError : null,
    connection,
    refreshing: stateMatchesScope ? state.refreshing : true,
    loadingOlder: stateMatchesScope ? loadingOlder : false,
    hasOlder: stateMatchesScope && state.cursor !== null,
    sendReadiness: publicSendReadiness(visibleSendReadiness),
    refresh,
    loadOlder,
    sendText,
    retryText,
  };
}
