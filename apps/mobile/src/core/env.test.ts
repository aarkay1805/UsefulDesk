import { mobileEnvironment, readMobileEnvironment } from './env';

const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  EXPO_PUBLIC_API_BASE_URL: 'https://desk.example.com',
  EXPO_PUBLIC_APP_ENV: 'test',
};

const legacyAnonJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5bnRoZXRpYy1wcm9qZWN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.-TilKikEUnklXeXPDiy37yuUOhwhb3Hhj3eoJXBMZDA';
const legacyServiceRoleJwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5bnRoZXRpYy1wcm9qZWN0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ.f6poBUjRk6Zp5QgM_iobT2XPkWNJ1ihNYxYT-5fPxGc';
const [legacyHeader, legacyAnonPayload, legacySignature] =
  legacyAnonJwt.split('.');

describe('readMobileEnvironment', () => {
  it('eagerly reads the test environment from setup', () => {
    expect(mobileEnvironment).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'test-anon-key',
      apiBaseUrl: 'http://localhost:3000',
      appEnvironment: 'test',
    });
  });

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

  it.each([
    ['EXPO_PUBLIC_SUPABASE_URL', 'not a URL'],
    ['EXPO_PUBLIC_API_BASE_URL', 'desk.example.com'],
  ])('rejects a malformed %s', (key, value) => {
    expect(() => readMobileEnvironment({ ...valid, [key]: value })).toThrow(
      key
    );
  });

  it.each(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_API_BASE_URL'])(
    'rejects HTTP for production %s, including loopback',
    (key) => {
      expect(() =>
        readMobileEnvironment({
          ...valid,
          EXPO_PUBLIC_APP_ENV: 'production',
          EXPO_PUBLIC_SUPABASE_ANON_KEY:
            'sb_publishable_synthetic-mobile-export-key',
          [key]: 'http://127.0.0.1:54321',
        })
      ).toThrow('HTTPS');
    }
  );

  it('permits HTTP only for loopback outside production', () => {
    expect(
      readMobileEnvironment({
        ...valid,
        EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3000',
        EXPO_PUBLIC_APP_ENV: 'development',
      })
    ).toMatchObject({
      supabaseUrl: 'http://127.0.0.1:54321',
      apiBaseUrl: 'http://localhost:3000',
    });

    expect(() =>
      readMobileEnvironment({
        ...valid,
        EXPO_PUBLIC_API_BASE_URL: 'http://desk.example.com',
        EXPO_PUBLIC_APP_ENV: 'development',
      })
    ).toThrow('HTTPS or a loopback HTTP URL');
  });

  it.each(['sb_secret_synthetic-server-key', legacyServiceRoleJwt])(
    'rejects a server credential without logging it',
    (key) => {
      const log = jest.spyOn(console, 'log').mockImplementation();
      const error = jest.spyOn(console, 'error').mockImplementation();

      expect(() =>
        readMobileEnvironment({
          ...valid,
          EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
        })
      ).toThrow('EXPO_PUBLIC_SUPABASE_ANON_KEY');
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();

      log.mockRestore();
      error.mockRestore();
    }
  );

  it.each(['sb_publishable_synthetic-mobile-export-key', legacyAnonJwt])(
    'accepts a recognized production public key',
    (key) => {
      expect(
        readMobileEnvironment({
          ...valid,
          EXPO_PUBLIC_APP_ENV: 'production',
          EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
        }).supabaseAnonKey
      ).toBe(key);
    }
  );

  it('rejects an unrecognized production key form', () => {
    expect(() =>
      readMobileEnvironment({
        ...valid,
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      })
    ).toThrow('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });

  it.each([
    `x.${legacyAnonPayload}.x`,
    `***.${legacyAnonPayload}.${legacySignature}`,
    `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${legacyAnonPayload}.${legacySignature}`,
    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpPU0UifQ.${legacyAnonPayload}.${legacySignature}`,
    `${legacyHeader}.${legacyAnonPayload}.x`,
    `${legacyHeader}.${legacyAnonPayload}.`,
    `${legacyHeader}.${legacyAnonPayload}.invalid+signature`,
    `${legacyAnonJwt}.extra`,
  ])(
    'rejects a malformed or implausible legacy JWT without echoing it',
    (key) => {
      expect(() =>
        readMobileEnvironment({
          ...valid,
          EXPO_PUBLIC_APP_ENV: 'production',
          EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
        })
      ).toThrow('EXPO_PUBLIC_SUPABASE_ANON_KEY');

      try {
        readMobileEnvironment({
          ...valid,
          EXPO_PUBLIC_APP_ENV: 'production',
          EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
        });
      } catch (error) {
        expect(String(error)).not.toContain(key);
      }
    }
  );
});
