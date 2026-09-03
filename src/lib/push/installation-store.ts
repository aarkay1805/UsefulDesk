import type { SupabaseClient } from '@supabase/supabase-js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_PUSH_TOKEN =
  /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export interface InstallationInput {
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  environment: 'development' | 'preview' | 'production';
  appVersion?: string;
  deviceModel?: string;
  osVersion?: string;
}

const INSTALLATION_KEYS = new Set([
  'installationId',
  'expoPushToken',
  'platform',
  'environment',
  'appVersion',
  'deviceModel',
  'osVersion',
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid push installation');
  }
  return value as Record<string, unknown>;
}

function boundedOptional(
  value: unknown,
  field: string,
  limit: number
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > limit ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`Invalid ${field}`);
  }
  return normalized;
}

export function parseInstallationInput(value: unknown): InstallationInput {
  const input = record(value);
  if (Object.keys(input).some((key) => !INSTALLATION_KEYS.has(key))) {
    throw new Error('Invalid unknown field');
  }
  if (
    typeof input.installationId !== 'string' ||
    !UUID.test(input.installationId)
  ) {
    throw new Error('Invalid installationId');
  }
  if (
    typeof input.expoPushToken !== 'string' ||
    input.expoPushToken.length > 512 ||
    !EXPO_PUSH_TOKEN.test(input.expoPushToken)
  ) {
    throw new Error('Invalid expoPushToken');
  }
  if (input.platform !== 'ios' && input.platform !== 'android') {
    throw new Error('Invalid platform');
  }
  if (
    input.environment !== 'development' &&
    input.environment !== 'preview' &&
    input.environment !== 'production'
  ) {
    throw new Error('Invalid environment');
  }

  const appVersion = boundedOptional(input.appVersion, 'appVersion', 64);
  const deviceModel = boundedOptional(input.deviceModel, 'deviceModel', 120);
  const osVersion = boundedOptional(input.osVersion, 'osVersion', 64);

  return {
    installationId: input.installationId,
    expoPushToken: input.expoPushToken,
    platform: input.platform,
    environment: input.environment,
    ...(appVersion ? { appVersion } : {}),
    ...(deviceModel ? { deviceModel } : {}),
    ...(osVersion ? { osVersion } : {}),
  };
}

export function parseRevocationInput(value: unknown): {
  installationId: string;
} {
  const input = record(value);
  if (
    Object.keys(input).length !== 1 ||
    typeof input.installationId !== 'string' ||
    !UUID.test(input.installationId)
  ) {
    throw new Error('Invalid installationId');
  }
  return { installationId: input.installationId };
}

export async function upsertPushInstallation(
  admin: Pick<SupabaseClient, 'rpc'>,
  userId: string,
  input: InstallationInput
): Promise<{ installationId: string; status: 'registered' }> {
  const { data, error } = await admin.rpc('register_push_installation', {
    p_user_id: userId,
    p_installation_id: input.installationId,
    p_platform: input.platform,
    p_environment: input.environment,
    p_expo_push_token: input.expoPushToken,
    p_app_version: input.appVersion ?? null,
    p_device_model: input.deviceModel ?? null,
    p_os_version: input.osVersion ?? null,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (
    error ||
    !row ||
    row.installation_id !== input.installationId ||
    row.registration_status !== 'registered'
  ) {
    throw new Error('Could not register push installation');
  }
  return { installationId: input.installationId, status: 'registered' };
}

export async function revokePushInstallation(
  admin: Pick<SupabaseClient, 'rpc'>,
  userId: string,
  installationId: string
): Promise<{ installationId: string; status: 'revoked' }> {
  const { error } = await admin.rpc('revoke_push_installation', {
    p_user_id: userId,
    p_installation_id: installationId,
  });
  if (error) throw new Error('Could not revoke push installation');
  return { installationId, status: 'revoked' };
}
