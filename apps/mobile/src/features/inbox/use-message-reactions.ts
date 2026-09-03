import { useCallback, useEffect, useRef, useState } from 'react';

import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type { InboxMessageReaction } from './inbox-types';
import type { ReactionRepository } from './reaction-repository';

export interface UseMessageReactionsOptions {
  accountId: string;
  conversationId: string;
  currentUserId: string;
  canMutate: boolean;
  realtime: InboxRealtimeFeed;
  repository: ReactionRepository;
  mutate(messageId: string, emoji: string): Promise<void>;
}

export interface UseMessageReactionsResult {
  reactions: InboxMessageReaction[];
  error: string | null;
  pendingMessageIds: ReadonlySet<string>;
  setReaction(messageId: string, emoji: string): Promise<void>;
  toggleReaction(messageId: string, emoji: string): Promise<void>;
}

interface ReactionState {
  scopeKey: string;
  reactions: InboxMessageReaction[];
  error: string | null;
  pendingMessageIds: Set<string>;
}

interface PendingReaction {
  token: number;
  scopeKey: string;
  messageId: string;
  emoji: string;
  previousOwn: InboxMessageReaction | null;
}

function applyOwnReaction(
  reactions: InboxMessageReaction[],
  messageId: string,
  currentUserId: string,
  emoji: string,
  conversationId: string
): InboxMessageReaction[] {
  const withoutOwn = reactions.filter(
    (item) =>
      !(
        item.messageId === messageId &&
        item.actorType === 'agent' &&
        item.actorId === currentUserId
      )
  );
  if (emoji === '') return withoutOwn;
  return [
    ...withoutOwn,
    {
      id: `optimistic:${messageId}`,
      messageId,
      conversationId,
      actorType: 'agent',
      actorId: currentUserId,
      emoji,
      createdAt: new Date().toISOString(),
    },
  ];
}

function mergePending(
  reactions: InboxMessageReaction[],
  pending: Iterable<PendingReaction>,
  scopeKey: string,
  currentUserId: string,
  conversationId: string
): InboxMessageReaction[] {
  let merged = reactions;
  for (const operation of pending) {
    if (operation.scopeKey !== scopeKey) continue;
    merged = applyOwnReaction(
      merged,
      operation.messageId,
      currentUserId,
      operation.emoji,
      conversationId
    );
  }
  return merged;
}

export function useMessageReactions(
  options: UseMessageReactionsOptions
): UseMessageReactionsResult {
  const scopeKey = `${options.accountId}:${options.conversationId}`;
  const [state, setState] = useState<ReactionState>(() => ({
    scopeKey,
    reactions: [],
    error: null,
    pendingMessageIds: new Set(),
  }));
  const stateRef = useRef(state);
  const scopeRef = useRef(scopeKey);
  const requestGenerationRef = useRef(0);
  const mutationTokenRef = useRef(0);
  const pendingRef = useRef(new Map<string, PendingReaction>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    let lastResyncGeneration = options.realtime.getSnapshot().resyncGeneration;
    const pending = pendingRef.current;
    requestGenerationRef.current += 1;
    pendingRef.current.clear();

    const load = () => {
      const requestGeneration = ++requestGenerationRef.current;
      void (async () => {
        try {
          const reactions = await options.repository.list(
            options.accountId,
            options.conversationId
          );
          if (
            cancelled ||
            scopeRef.current !== scopeKey ||
            requestGenerationRef.current !== requestGeneration
          ) {
            return;
          }
          setState({
            scopeKey,
            reactions: mergePending(
              reactions,
              pendingRef.current.values(),
              scopeKey,
              options.currentUserId,
              options.conversationId
            ),
            error: null,
            pendingMessageIds: new Set(pendingRef.current.keys()),
          });
        } catch {
          if (
            cancelled ||
            scopeRef.current !== scopeKey ||
            requestGenerationRef.current !== requestGeneration
          ) {
            return;
          }
          setState((current) => ({
            ...(current.scopeKey === scopeKey
              ? current
              : {
                  scopeKey,
                  reactions: [],
                  pendingMessageIds: new Set<string>(),
                }),
            error: 'Could not load reactions',
          }));
        }
      })();
    };

    void (async () => {
      if (cancelled || scopeRef.current !== scopeKey) return;
      setState({
        scopeKey,
        reactions: [],
        error: null,
        pendingMessageIds: new Set(),
      });
      load();
    })();

    const stopEvents = options.realtime.listen((event) => {
      if (
        event.table === 'message_reactions' &&
        event.accountId === options.accountId &&
        event.conversationId === options.conversationId
      ) {
        load();
      }
    });
    const stopStatus = options.realtime.listenStatus((snapshot) => {
      if (snapshot.resyncGeneration === lastResyncGeneration) return;
      lastResyncGeneration = snapshot.resyncGeneration;
      load();
    });

    return () => {
      cancelled = true;
      requestGenerationRef.current += 1;
      pending.clear();
      stopEvents();
      stopStatus();
    };
  }, [
    options.accountId,
    options.conversationId,
    options.currentUserId,
    options.realtime,
    options.repository,
    scopeKey,
  ]);

  const setReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!options.canMutate || pendingRef.current.has(messageId)) return;
      const current = stateRef.current;
      if (current.scopeKey !== scopeKey) return;
      const previousOwn =
        current.reactions.find(
          (item) =>
            item.messageId === messageId &&
            item.actorType === 'agent' &&
            item.actorId === options.currentUserId
        ) ?? null;
      const operation: PendingReaction = {
        token: ++mutationTokenRef.current,
        scopeKey,
        messageId,
        emoji,
        previousOwn,
      };
      pendingRef.current.set(messageId, operation);
      setState((latest) => {
        if (latest.scopeKey !== scopeKey) return latest;
        return {
          ...latest,
          reactions: applyOwnReaction(
            latest.reactions,
            messageId,
            options.currentUserId,
            emoji,
            options.conversationId
          ),
          error: null,
          pendingMessageIds: new Set(pendingRef.current.keys()),
        };
      });

      let failed = false;
      try {
        await options.mutate(messageId, emoji);
      } catch {
        failed = true;
      }

      if (
        scopeRef.current !== scopeKey ||
        pendingRef.current.get(messageId)?.token !== operation.token
      ) {
        return;
      }
      pendingRef.current.delete(messageId);
      setState((latest) => {
        if (latest.scopeKey !== scopeKey) return latest;
        let reactions = latest.reactions;
        if (failed) {
          reactions = applyOwnReaction(
            reactions,
            messageId,
            options.currentUserId,
            operation.previousOwn?.emoji ?? '',
            options.conversationId
          );
          if (operation.previousOwn) {
            reactions = reactions.map((item) =>
              item.id === `optimistic:${messageId}`
                ? operation.previousOwn!
                : item
            );
          }
        }
        return {
          ...latest,
          reactions,
          error: failed ? 'Could not update reaction. Try again.' : null,
          pendingMessageIds: new Set(pendingRef.current.keys()),
        };
      });
    },
    [options, scopeKey]
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const own = stateRef.current.reactions.find(
        (item) =>
          item.messageId === messageId &&
          item.actorType === 'agent' &&
          item.actorId === options.currentUserId
      );
      await setReaction(messageId, own?.emoji === emoji ? '' : emoji);
    },
    [options.currentUserId, setReaction]
  );

  const visibleState = state.scopeKey === scopeKey ? state : null;
  return {
    reactions: visibleState?.reactions ?? [],
    error: visibleState?.error ?? null,
    pendingMessageIds: visibleState?.pendingMessageIds ?? new Set(),
    setReaction,
    toggleReaction,
  };
}
