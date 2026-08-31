import { readMobileEnvironment } from './env';

const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  EXPO_PUBLIC_API_BASE_URL: 'https://desk.example.com',
  EXPO_PUBLIC_APP_ENV: 'test',
};

describe('readMobileEnvironment', () => {
  it('returns a validated public environment', () => {
    expect(readMobileEnvironment(valid)).toEqual({
      supabaseUrl: valid.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: valid.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      apiBaseUrl: valid.EXPO_PUBLIC_API_BASE_URL,
      appEnvironment: 'test',
    });
  });

  it.each([
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_API_BASE_URL',
  ])('rejects a missing %s', (key) => {
    expect(() => readMobileEnvironment({ ...valid, [key]: '' })).toThrow(key);
  });

  it('rejects a non-HTTPS production API URL', () => {
    expect(() =>
      readMobileEnvironment({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_BASE_URL: 'http://desk.example.com',
      })
    ).toThrow('HTTPS');
  });
});
