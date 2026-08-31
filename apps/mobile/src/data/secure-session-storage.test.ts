import { createSecureSessionStorage } from './secure-session-storage';

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
});
