import type { NativeNotifications } from '../../native/notifications';
import type { InstallationStorage } from './installation-storage';
import type {
  InstallationRegistration,
  NotificationAuth,
  NotificationSnapshot,
  RemovableSubscription,
} from './notification-types';
import type { PushClient } from './push-client';

interface CoordinatorDependencies {
  native: NativeNotifications;
  storage: InstallationStorage;
  push: PushClient;
  installation: Omit<
    InstallationRegistration,
    'installationId' | 'expoPushToken'
  >;
  refreshAccessToken(): Promise<string | null>;
}

export interface NotificationCoordinator {
  start(auth: NotificationAuth): Promise<void>;
  refresh(auth: NotificationAuth): Promise<void>;
  requestPermission(auth: NotificationAuth): Promise<void>;
  revoke(accessToken: string): Promise<void>;
  openSettings(): Promise<void>;
  markExplanationShown(): Promise<void>;
  getSnapshot(): NotificationSnapshot;
  subscribe(listener: () => void): () => void;
  whenIdle(): Promise<void>;
  stop(): void;
}

const snapshots = {
  checking: (): NotificationSnapshot => ({
    status: 'checking',
    canRequest: false,
    shouldExplain: false,
    message: 'Checking notification access…',
    recoveryAction: null,
  }),
  requestable: (shouldExplain: boolean): NotificationSnapshot => ({
    status: 'requestable',
    canRequest: true,
    shouldExplain,
    message: 'Get notified when a customer sends a message.',
    recoveryAction: 'request',
  }),
  denied: (): NotificationSnapshot => ({
    status: 'denied',
    canRequest: false,
    shouldExplain: false,
    message: 'Notifications are off in system settings.',
    recoveryAction: 'settings',
  }),
  enabled: (): NotificationSnapshot => ({
    status: 'enabled',
    canRequest: false,
    shouldExplain: false,
    message: 'New customer messages can notify this device.',
    recoveryAction: null,
  }),
  unavailable: (): NotificationSnapshot => ({
    status: 'unavailable',
    canRequest: false,
    shouldExplain: false,
    message: 'Push notifications are unavailable on this device.',
    recoveryAction: null,
  }),
  retry: (): NotificationSnapshot => ({
    status: 'retry_needed',
    canRequest: false,
    shouldExplain: false,
    message: 'Notification setup needs another try.',
    recoveryAction: 'retry',
  }),
};

export function createNotificationCoordinator({
  native,
  storage,
  push,
  installation,
  refreshAccessToken,
}: CoordinatorDependencies): NotificationCoordinator {
  let snapshot = snapshots.checking();
  let currentAuth: NotificationAuth | null = null;
  let tokenSubscription: RemovableSubscription | null = null;
  let generation = 0;
  let operationTail = Promise.resolve();
  const listeners = new Set<() => void>();

  const publish = (next: NotificationSnapshot, expected = generation) => {
    if (expected !== generation) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const enqueue = (operation: () => Promise<void>) => {
    const result = operationTail.then(operation, operation);
    operationTail = result.catch(() => undefined);
    return result;
  };

  const registration = async (expoPushToken: string) => ({
    ...installation,
    installationId: await storage.getOrCreateId(),
    expoPushToken,
  });

  const register = async (
    auth: NotificationAuth,
    expected: number,
    suppliedToken?: string
  ) => {
    try {
      const payload = await registration(
        suppliedToken ?? (await native.getExpoPushToken())
      );
      if (expected !== generation) return;
      try {
        await push.register(auth.accessToken, payload);
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'unauthorized'
        ) {
          throw error;
        }
        const accessToken = await refreshAccessToken();
        if (!accessToken || expected !== generation) throw error;
        currentAuth = { ...auth, accessToken };
        await push.register(accessToken, payload);
      }
      publish(snapshots.enabled(), expected);
    } catch {
      publish(snapshots.retry(), expected);
    }
  };

  const reconcile = async (
    auth: NotificationAuth,
    expected: number,
    request: boolean
  ) => {
    publish(snapshots.checking(), expected);
    if (!native.isAvailable()) {
      publish(snapshots.unavailable(), expected);
      return;
    }
    try {
      await native.ensureMessagesChannel();
      let permission = await native.getPermission();
      if (request && !permission.granted) {
        if (!permission.canAskAgain) {
          publish(snapshots.denied(), expected);
          return;
        }
        permission = await native.requestPermission();
      }
      if (!permission.granted) {
        const explained = await storage.wasExplanationShown();
        publish(
          permission.canAskAgain
            ? snapshots.requestable(!explained)
            : snapshots.denied(),
          expected
        );
        return;
      }
      await register(auth, expected);
    } catch {
      publish(snapshots.retry(), expected);
    }
  };

  const start = (auth: NotificationAuth) => {
    currentAuth = auth;
    const expected = ++generation;
    native.configureForegroundPresentation();
    tokenSubscription?.remove();
    tokenSubscription = native.addPushTokenListener(() => {
      const active = currentAuth;
      if (!active) return;
      void enqueue(() => register(active, generation));
    });
    return enqueue(() => reconcile(auth, expected, false));
  };

  return {
    start,
    refresh: (auth) => {
      currentAuth = auth;
      const expected = ++generation;
      return enqueue(() => reconcile(auth, expected, false));
    },
    requestPermission: (auth) => {
      currentAuth = auth;
      const expected = ++generation;
      return enqueue(() => reconcile(auth, expected, true));
    },
    revoke: (accessToken) =>
      enqueue(async () => {
        try {
          await push.revoke(accessToken, await storage.getOrCreateId());
        } catch {
          publish(snapshots.retry());
        }
      }),
    openSettings: () => native.openSettings(),
    markExplanationShown: () => storage.markExplanationShown(),
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    whenIdle: () => operationTail,
    stop: () => {
      generation += 1;
      currentAuth = null;
      tokenSubscription?.remove();
      tokenSubscription = null;
      listeners.clear();
    },
  };
}
