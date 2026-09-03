import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import type {
  PermissionSnapshot,
  RemovableSubscription,
} from '../features/notifications/notification-types';

interface ExpoNotificationsAdapter {
  setNotificationChannelAsync(
    channelId: string,
    channel: object
  ): Promise<unknown>;
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync(): Promise<{
    granted: boolean;
    canAskAgain: boolean;
  }>;
  getExpoPushTokenAsync(options: {
    projectId: string;
  }): Promise<{ data: string }>;
  setNotificationHandler(handler: {
    handleNotification(): Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }): void;
  addPushTokenListener(listener: () => void): RemovableSubscription;
  addNotificationResponseReceivedListener(
    listener: (response: unknown) => void
  ): RemovableSubscription;
  getLastNotificationResponseAsync(): Promise<unknown | null>;
}

interface NativeNotificationDependencies {
  notifications: ExpoNotificationsAdapter;
  platform: string;
  isDevice: boolean;
  projectId: string | null;
  openSettings(): Promise<void>;
  highImportance?: number;
}

export interface NativeNotifications {
  isAvailable(): boolean;
  configureForegroundPresentation(): void;
  ensureMessagesChannel(): Promise<void>;
  getPermission(): Promise<PermissionSnapshot>;
  requestPermission(): Promise<PermissionSnapshot>;
  getExpoPushToken(): Promise<string>;
  addPushTokenListener(listener: () => void): RemovableSubscription;
  addNotificationResponseListener(
    listener: (response: unknown) => void
  ): RemovableSubscription;
  getLastNotificationResponse(): Promise<unknown | null>;
  openSettings(): Promise<void>;
}

export function createNativeNotifications({
  notifications,
  platform,
  isDevice,
  projectId,
  openSettings,
  highImportance = 4,
}: NativeNotificationDependencies): NativeNotifications {
  const ensureMessagesChannel = async () => {
    if (platform !== 'android') return;
    await notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: highImportance,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  };

  const permission = (value: {
    granted: boolean;
    canAskAgain: boolean;
  }): PermissionSnapshot => ({
    granted: value.granted,
    canAskAgain: value.canAskAgain,
  });

  return {
    isAvailable: () => isDevice && Boolean(projectId),
    configureForegroundPresentation: () => {
      notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    },
    ensureMessagesChannel,
    getPermission: async () =>
      permission(await notifications.getPermissionsAsync()),
    requestPermission: async () => {
      await ensureMessagesChannel();
      return permission(await notifications.requestPermissionsAsync());
    },
    getExpoPushToken: async () => {
      if (!isDevice || !projectId) {
        throw new Error('Push notifications unavailable');
      }
      const token = await notifications.getExpoPushTokenAsync({ projectId });
      return token.data;
    },
    addPushTokenListener: (listener) =>
      notifications.addPushTokenListener(listener),
    addNotificationResponseListener: (listener) =>
      notifications.addNotificationResponseReceivedListener(listener),
    getLastNotificationResponse: () =>
      notifications.getLastNotificationResponseAsync(),
    openSettings,
  };
}

const projectId =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

export const nativeNotifications = createNativeNotifications({
  notifications: Notifications,
  platform: Platform.OS,
  isDevice: Device.isDevice,
  projectId: typeof projectId === 'string' ? projectId : null,
  highImportance: Notifications.AndroidImportance.HIGH,
  openSettings: () => Linking.openSettings(),
});
