import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import {
  useAuth,
  type AuthState,
  type AuthContextValue,
} from '../auth/auth-context';
import { mobileConversationRepository } from '../inbox/conversation-repository';
import { nativeNotifications } from '../../native/notifications';
import {
  destinationFromNotificationResponse,
  type PushDestination,
} from './notification-routing';

const UNAVAILABLE = 'This conversation is no longer available.';

interface ResponseRouterDependencies {
  selectBranch(accountId: string): Promise<void>;
  getConversation(accountId: string, conversationId: string): Promise<unknown>;
  replaceInbox(): void;
  openConversation(conversationId: string): void;
  showUnavailable(message: string): void;
  timeoutMs?: number;
}

export interface NotificationResponseRouter {
  enqueue(response: unknown): boolean;
  reconcile(state: AuthState): Promise<void>;
  stop(): void;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createNotificationResponseRouter({
  selectBranch,
  getConversation,
  replaceInbox,
  openConversation,
  showUnavailable,
  timeoutMs = 8_000,
}: ResponseRouterDependencies): NotificationResponseRouter {
  let pending: PushDestination | null = null;
  let revision = 0;
  let stopped = false;
  const handled = new Set<string>();

  const current = (expected: number, deliveryId: string) =>
    !stopped && revision === expected && pending?.deliveryId === deliveryId;

  const fail = (expected: number, destination: PushDestination) => {
    if (!current(expected, destination.deliveryId)) return;
    handled.add(destination.deliveryId);
    pending = null;
    replaceInbox();
    showUnavailable(UNAVAILABLE);
  };

  return {
    enqueue(response) {
      const destination = destinationFromNotificationResponse(response);
      if (!destination || handled.has(destination.deliveryId) || stopped) {
        return false;
      }
      if (pending?.deliveryId === destination.deliveryId) return false;
      pending = destination;
      revision += 1;
      return true;
    },
    async reconcile(state) {
      const destination = pending;
      if (!destination || stopped || state.status !== 'ready') return;
      const expected = revision;
      const branch = state.branches.find(
        (candidate) => candidate.account_id === destination.accountId
      );
      if (!branch || branch.branch_status === 'archived') {
        fail(expected, destination);
        return;
      }
      if (state.branch.account_id !== destination.accountId) {
        try {
          await withTimeout(selectBranch(destination.accountId), timeoutMs);
        } catch {
          fail(expected, destination);
        }
        return;
      }
      try {
        await withTimeout(
          getConversation(destination.accountId, destination.conversationId),
          timeoutMs
        );
        if (!current(expected, destination.deliveryId)) return;
        handled.add(destination.deliveryId);
        pending = null;
        replaceInbox();
        openConversation(destination.conversationId);
      } catch {
        fail(expected, destination);
      }
    },
    stop() {
      stopped = true;
      revision += 1;
      pending = null;
      handled.clear();
    },
  };
}

export function NotificationRouter() {
  const auth = useAuth();
  const router = useRouter();
  const authRef = useRef<AuthContextValue>(auth);
  authRef.current = auth;
  const responseRouterRef = useRef<NotificationResponseRouter | null>(null);

  if (!responseRouterRef.current) {
    responseRouterRef.current = createNotificationResponseRouter({
      selectBranch: (accountId) => authRef.current.selectBranch(accountId),
      getConversation: (accountId, conversationId) =>
        mobileConversationRepository.get(accountId, conversationId),
      replaceInbox: () => router.replace('/(app)'),
      openConversation: (conversationId) =>
        router.push({
          pathname: '/(app)/conversation/[conversationId]',
          params: { conversationId },
        }),
      showUnavailable: (message) =>
        Alert.alert('Conversation unavailable', message),
    });
  }

  useEffect(() => {
    const responseRouter = responseRouterRef.current!;
    let cancelled = false;
    const subscription = nativeNotifications.addNotificationResponseListener(
      (response) => {
        if (responseRouter.enqueue(response)) {
          void responseRouter.reconcile(authRef.current.state);
        }
      }
    );
    void (async () => {
      const response = await nativeNotifications.getLastNotificationResponse();
      if (cancelled || !response) return;
      if (responseRouter.enqueue(response)) {
        await responseRouter.reconcile(authRef.current.state);
      }
    })();
    return () => {
      cancelled = true;
      subscription.remove();
      responseRouter.stop();
    };
  }, []);

  useEffect(() => {
    void responseRouterRef.current?.reconcile(auth.state);
  }, [auth.state]);

  return null;
}
