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

    expect(storage.allowWrites()).toBe(true);
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'new-sign-in');
    expect(values.get(MOBILE_AUTH_STORAGE_KEY)).toBe('new-sign-in');
  });

  it('durably tombstones every owned slot when deletion fails', async () => {
    const values = new Map<string, string>(
      MOBILE_AUTH_STORAGE_KEYS.map((key) => [key, `stored:${key}`])
    );
    const storage = createSecureSessionStorage({
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        values.set(key, value);
      },
      deleteItemAsync: async () => {
        throw new Error('secure store deletion failed');
      },
    });

    await expect(storage.purge()).resolves.toEqual({ status: 'success' });
    expect([...values.entries()]).toEqual(
      MOBILE_AUTH_STORAGE_KEYS.map((key) => [key, 'null'])
    );

    const coldStorage = createSecureSessionStorage({
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        values.set(key, value);
      },
      deleteItemAsync: async () => {
        throw new Error('secure store deletion failed');
      },
    });
    for (const key of MOBILE_AUTH_STORAGE_KEYS) {
      await expect(coldStorage.getItem(key)).resolves.toBeNull();
    }
  });

  it('attempts every key and remains write-blocked when cleanup cannot be verified', async () => {
    const attempted: string[] = [];
    const values = new Map<string, string>([
      [MOBILE_AUTH_STORAGE_KEY, 'still-present'],
    ]);
    const storage = createSecureSessionStorage({
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (key === MOBILE_AUTH_STORAGE_KEY) {
          throw new Error('platform storage diagnostic with secret');
        }
        values.set(key, value);
      },
      deleteItemAsync: async (key) => {
        attempted.push(key);
        if (key === MOBILE_AUTH_STORAGE_KEY) {
          throw new Error('platform storage diagnostic with secret');
        }
      },
    });

    await expect(storage.purge()).resolves.toEqual({ status: 'failed' });
    expect(attempted).toEqual(MOBILE_AUTH_STORAGE_KEYS);
    expect(storage.allowWrites()).toBe(false);
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'new-session');
    expect(values.get(MOBILE_AUTH_STORAGE_KEY)).toBe('still-present');
  });

  it('allows a cleanup retry to repair storage before enabling sign-in writes', async () => {
    const values = new Map<string, string>([
      [MOBILE_AUTH_STORAGE_KEY, 'still-present'],
    ]);
    let storageBroken = true;
    const storage = createSecureSessionStorage({
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (storageBroken) throw new Error('write failed');
        values.set(key, value);
      },
      deleteItemAsync: async (key) => {
        if (storageBroken) throw new Error('delete failed');
        values.delete(key);
      },
    });

    await expect(storage.purge()).resolves.toEqual({ status: 'failed' });
    expect(storage.allowWrites()).toBe(false);

    storageBroken = false;
    await expect(storage.purge()).resolves.toEqual({ status: 'success' });
    expect(storage.allowWrites()).toBe(true);
    await storage.setItem(MOBILE_AUTH_STORAGE_KEY, 'new-session');
    expect(values.get(MOBILE_AUTH_STORAGE_KEY)).toBe('new-session');
  });
});
