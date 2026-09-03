import * as Application from 'expo-application';
import * as Device from 'expo-device';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { AppState, Platform } from 'react-native';

import { mobileEnvironment, pushEnvironment } from '../../core/env';
import { mobileSupabase } from '../../data/supabase';
import { nativeNotifications } from '../../native/notifications';
import { useAuth } from '../auth/auth-context';
import {
  createNotificationCoordinator,
  type NotificationCoordinator,
} from './notification-coordinator';
import { installationStorage } from './installation-storage';
import {
  notificationPermissionPrompt,
  type NotificationPermissionPrompt,
} from './notification-permission-prompt';
import { registerNotificationRevoker } from './notification-signout';
import type {
  NotificationAuth,
  NotificationSnapshot,
} from './notification-types';
import { pushClient } from './push-client';

interface AppStateSource {
  addEventListener(
    event: 'change',
    listener: (state: string) => void
  ): { remove(): void };
}

export interface NotificationsProviderDependencies {
  coordinator: NotificationCoordinator;
  appState: AppStateSource;
  prompt: NotificationPermissionPrompt;
}

export interface NotificationsContextValue extends NotificationSnapshot {
  requestPermission(): Promise<void>;
  openSettings(): Promise<void>;
  revoke(accessToken: string): Promise<void>;
}

const coordinator = createNotificationCoordinator({
  native: nativeNotifications,
  storage: installationStorage,
  push: pushClient,
  installation: {
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    environment: pushEnvironment(mobileEnvironment.appEnvironment),
    appVersion: Application.nativeApplicationVersion,
    deviceModel: Device.modelName,
    osVersion: Device.osVersion,
  },
  refreshAccessToken: async () => {
    const { data, error } = await mobileSupabase.auth.refreshSession();
    return error ? null : (data.session?.access_token ?? null);
  },
});

const defaultDependencies: NotificationsProviderDependencies = {
  coordinator,
  appState: AppState,
  prompt: notificationPermissionPrompt,
};

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null
);

function notificationAuth(
  state: ReturnType<typeof useAuth>['state']
): NotificationAuth | null {
  if (state.status !== 'ready') return null;
  return {
    accessToken: state.session.access_token,
    userId: state.session.user.id,
  };
}

export function NotificationsProvider({
  children,
  dependencies = defaultDependencies,
}: PropsWithChildren<{
  dependencies?: NotificationsProviderDependencies;
}>) {
  const auth = useAuth();
  const promptKeyRef = useRef<string | null>(null);
  const snapshot = useSyncExternalStore(
    dependencies.coordinator.subscribe,
    dependencies.coordinator.getSnapshot,
    dependencies.coordinator.getSnapshot
  );

  const ready = notificationAuth(auth.state);
  const accessToken = ready?.accessToken ?? null;
  const userId = ready?.userId ?? null;

  useEffect(() => {
    if (!accessToken || !userId) {
      dependencies.coordinator.stop();
      promptKeyRef.current = null;
      return;
    }
    void dependencies.coordinator.start({ accessToken, userId });
  }, [accessToken, dependencies.coordinator, userId]);

  useEffect(() => {
    const subscription = dependencies.appState.addEventListener(
      'change',
      (state) => {
        const active = accessToken && userId ? { accessToken, userId } : null;
        if (state === 'active' && active) {
          void dependencies.coordinator.refresh(active);
        }
      }
    );
    const unregisterRevoker = registerNotificationRevoker((token) =>
      dependencies.coordinator.revoke(token)
    );
    return () => {
      unregisterRevoker();
      subscription.remove();
      dependencies.coordinator.stop();
    };
  }, [accessToken, dependencies.appState, dependencies.coordinator, userId]);

  useEffect(() => {
    if (!ready || !snapshot.shouldExplain) return;
    const promptKey = `${ready.userId}:${auth.state.status === 'ready' ? auth.state.branch.account_id : ''}`;
    if (promptKeyRef.current === promptKey) return;
    promptKeyRef.current = promptKey;
    dependencies.prompt.show({
      onNotNow: () => {
        void dependencies.coordinator.markExplanationShown();
      },
      onContinue: () => {
        void (async () => {
          await dependencies.coordinator.markExplanationShown();
          await dependencies.coordinator.requestPermission(ready);
        })();
      },
    });
  }, [
    auth.state,
    dependencies.coordinator,
    dependencies.prompt,
    ready,
    snapshot.shouldExplain,
  ]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      ...snapshot,
      requestPermission: async () => {
        const current = accessToken && userId ? { accessToken, userId } : null;
        if (current) await dependencies.coordinator.requestPermission(current);
      },
      openSettings: () => dependencies.coordinator.openSettings(),
      revoke: (token) => dependencies.coordinator.revoke(token),
    }),
    [accessToken, dependencies.coordinator, snapshot, userId]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error(
      'useNotifications must be used within NotificationsProvider.'
    );
  }
  return value;
}
