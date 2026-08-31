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

  const apiBaseUrl = required(source, 'EXPO_PUBLIC_API_BASE_URL');
  if (appEnvironment === 'production' && !apiBaseUrl.startsWith('https://')) {
    throw new Error('Production API URL must use HTTPS');
  }

  return {
    supabaseUrl: required(source, 'EXPO_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: required(source, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
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
