import {
  createInstallationStorage,
  EXPLANATION_KEY,
  INSTALLATION_ID_KEY,
} from './installation-storage';

describe('notification installation storage', () => {
  it('creates one stable installation UUID and persists the explanation flag', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      deleteItemAsync: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const installation = createInstallationStorage(
      storage,
      () => '11111111-1111-4111-8111-111111111111'
    );
    await expect(installation.getOrCreateId()).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    await expect(installation.getOrCreateId()).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(storage.setItemAsync).toHaveBeenCalledTimes(1);
    expect(storage.setItemAsync).toHaveBeenCalledWith(
      INSTALLATION_ID_KEY,
      '11111111-1111-4111-8111-111111111111'
    );

    await expect(installation.wasExplanationShown()).resolves.toBe(false);
    await installation.markExplanationShown();
    await expect(installation.wasExplanationShown()).resolves.toBe(true);
    expect(values.get(EXPLANATION_KEY)).toBe('true');
  });

  it('replaces malformed persisted identifiers without logging them', async () => {
    const storage = {
      getItemAsync: jest.fn().mockResolvedValue('secret malformed id'),
      setItemAsync: jest.fn().mockResolvedValue(undefined),
      deleteItemAsync: jest.fn().mockResolvedValue(undefined),
    };
    const log = jest.spyOn(console, 'log').mockImplementation();
    const installation = createInstallationStorage(
      storage,
      () => '22222222-2222-4222-8222-222222222222'
    );

    await expect(installation.getOrCreateId()).resolves.toBe(
      '22222222-2222-4222-8222-222222222222'
    );
    expect(log).not.toHaveBeenCalled();
  });
});
