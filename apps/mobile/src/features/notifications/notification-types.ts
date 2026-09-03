import type { PushEnvironment } from '../../core/env';

export type NotificationStatus =
  | 'checking'
  | 'requestable'
  | 'denied'
  | 'enabled'
  | 'unavailable'
  | 'retry_needed';

export interface NotificationSnapshot {
  status: NotificationStatus;
  canRequest: boolean;
  shouldExplain: boolean;
  message: string;
  recoveryAction: 'request' | 'settings' | 'retry' | null;
}

export interface NotificationAuth {
  accessToken: string;
  userId: string;
}

export interface InstallationRegistration {
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  environment: PushEnvironment;
  appVersion: string | null;
  deviceModel: string | null;
  osVersion: string | null;
}

export interface PermissionSnapshot {
  granted: boolean;
  canAskAgain: boolean;
}

export interface RemovableSubscription {
  remove(): void;
}
