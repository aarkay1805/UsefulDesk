export type AppEnvironment = 'development' | 'test' | 'production';

export interface MobileEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  appEnvironment: AppEnvironment;
}

type EnvironmentSource = Record<string, string | undefined>;

const required = (source: EnvironmentSource, key: string) => {
  const value = source[key]?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '[::1]') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  return Boolean(
    match &&
    match.slice(1).every((part) => Number(part) <= 255) &&
    Number(match[1]) === 127
  );
}

function publicBaseUrl(
  source: EnvironmentSource,
  key: string,
  appEnvironment: AppEnvironment
): string {
  const value = required(source, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${key}`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid ${key}`);
  }
  if (url.protocol === 'https:') return value;
  if (
    appEnvironment !== 'production' &&
    url.protocol === 'http:' &&
    isLoopbackHost(url.hostname)
  ) {
    return value;
  }
  if (appEnvironment === 'production') {
    throw new Error(`${key} must use HTTPS in production`);
  }
  throw new Error(`${key} must use HTTPS or a loopback HTTP URL`);
}

const base64UrlSegment = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(segment: string): string | null {
  if (!segment || !base64UrlSegment.test(segment) || segment.length % 4 === 1) {
    return null;
  }

  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    return globalThis.atob(
      normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    );
  } catch {
    return null;
  }
}

function legacyJwtRole(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 3) return value.includes('.') ? '' : null;

  const headerSource = decodeBase64Url(parts[0]);
  const payloadSource = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  if (!headerSource || !payloadSource || signature?.length !== 32) return '';

  try {
    const header = JSON.parse(headerSource) as unknown;
    const decoded = JSON.parse(payloadSource) as unknown;
    if (
      typeof header === 'object' &&
      header !== null &&
      'alg' in header &&
      header.alg === 'HS256' &&
      'typ' in header &&
      header.typ === 'JWT' &&
      typeof decoded === 'object' &&
      decoded !== null &&
      'role' in decoded &&
      typeof decoded.role === 'string'
    ) {
      return decoded.role;
    }
  } catch {
    return '';
  }
  return '';
}

function publicSupabaseKey(
  source: EnvironmentSource,
  appEnvironment: AppEnvironment
): string {
  const keyName = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';
  const value = required(source, keyName);
  if (value.startsWith('sb_secret_')) {
    throw new Error(`Invalid ${keyName}`);
  }

  const role = legacyJwtRole(value);
  if (role !== null && role !== 'anon') {
    throw new Error(`Invalid ${keyName}`);
  }
  if (appEnvironment !== 'production') return value;

  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value) || role === 'anon') {
    return value;
  }
  throw new Error(`Invalid ${keyName}`);
}

export function readMobileEnvironment(
  source: EnvironmentSource = process.env
): MobileEnvironment {
  const appEnvironment = required(
    source,
    'EXPO_PUBLIC_APP_ENV'
  ) as AppEnvironment;
  if (!['development', 'test', 'production'].includes(appEnvironment)) {
    throw new Error('Invalid EXPO_PUBLIC_APP_ENV');
  }

  const supabaseUrl = publicBaseUrl(
    source,
    'EXPO_PUBLIC_SUPABASE_URL',
    appEnvironment
  );
  const apiBaseUrl = publicBaseUrl(
    source,
    'EXPO_PUBLIC_API_BASE_URL',
    appEnvironment
  );

  return {
    supabaseUrl,
    supabaseAnonKey: publicSupabaseKey(source, appEnvironment),
    apiBaseUrl,
    appEnvironment,
  };
}

const runtimeEnvironmentSource: EnvironmentSource = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
};

export const mobileEnvironment = readMobileEnvironment(
  runtimeEnvironmentSource
);
