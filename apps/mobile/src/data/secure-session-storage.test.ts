import {
  createSecureSessionStorage,
  MOBILE_AUTH_STORAGE_KEY,
  MOBILE_AUTH_STORAGE_KEYS,
} from './secure-session-storage';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('createSecureSessionStorage', () => {
  it('delegates each storage operation without enumerating or logging session values', async () => {
    const calls: string[][] = [];
    const adapter = new Proxy(
      {
        getItemAsync: async (key: string) => {
          calls.push(['get', key]);
          return 'human-session-token';
        },
        setItemAsync: async (key: string, value: string) => {
          calls.push(['set', key, value]);
        },
        deleteItemAsync: async (key: string) => {
          calls.push(['remove', key]);
        },
      },
      {
        ownKeys: () => {
          throw new Error('Storage adapters must not be enumerated');
        },
      }
    );
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn'].map(
      (method) =>
        jest.spyOn(console, method as keyof Console).mockImplementation()
    );

    const storage = createSecureSessionStorage(adapter);

    await expect(storage.getItem('supabase.auth.token')).resolves.toBe(
      'human-session-token'
    );
    await storage.setItem('supabase.auth.token', 'human-session-token');
    await storage.removeItem('supabase.auth.token');

    expect(calls).toEqual([
      ['get', 'supabase.auth.token'],
      ['set', 'supabase.auth.token', 'human-session-token'],
      ['remove', 'supabase.auth.token'],
    ]);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it('purges the exact configured session, PKCE verifier, and user keys', async () => {
    const values = new Map<string, string>(
      MOBILE_AUTH_STORAGE_KEYS.map((key) => [key, `stored:${key}`])
    );
    const removed: string[] = [];
    const storage = createSecureSessionStorage({
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        values.set(key, value);
      },
      deleteItemAsync: async (key) => {
        removed.push(key);
        values.delete(key);
      },
    });

    await expect(storage.purge()).resolves.toEqual({ status: 'success' });

    expect(removed).toEqual(MOBILE_AUTH_STORAGE_KEYS);
    expect(values.size).toBe(0);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBeNull();
  });

  it('prevents an in-flight or later refresh write from restoring a purged session', async () => {
    const values = new Map<string, string>();
    const writeStarted = deferred();
    const finishWrite = deferred();
    const storage = createSecureSessionStorage({
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        writeStarted.resolve();
        await finishWrite.promise;
        values.set(key, value);
      },
      deleteItemAsync: async (key) => {
        values.delete(key);
      },
    });

    const staleRefresh = storage.setItem(
      MOBILE_AUTH_STORAGE_KEY,
      'rotated-session'
    );
    await writeStarted.promise;
    const purge = storage.purge();
    finishWrite.resolve();
    await staleRefresh;
    await expect(purge).resolves.toEqual({ status: 'success' });

    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'later-refresh');
    expect(values.has(MOBILE_AUTH_STORAGE_KEY)).toBe(false);
    await expect(storage.getItem(MOBILE_AUTH_STORAGE_KEY)).resolves.toBeNull();

    storage.allowWrites();
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'new-sign-in');
    expect(values.get(MOBILE_AUTH_STORAGE_KEY)).toBe('new-sign-in');
  });

  it('attempts every key and reports a partial purge failure without exposing values', async () => {
    const attempted: string[] = [];
    const storage = createSecureSessionStorage({
      getItemAsync: async () => null,
      setItemAsync: async () => undefined,
      deleteItemAsync: async (key) => {
        attempted.push(key);
        if (key === MOBILE_AUTH_STORAGE_KEY) {
          throw new Error('platform storage diagnostic with secret');
        }
      },
    });

    await expect(storage.purge()).resolves.toEqual({ status: 'failed' });
    expect(attempted).toEqual(MOBILE_AUTH_STORAGE_KEYS);
  });
});
