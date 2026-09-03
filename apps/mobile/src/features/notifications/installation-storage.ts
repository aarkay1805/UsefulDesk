import * as SecureStore from 'expo-secure-store';

export const INSTALLATION_ID_KEY = 'usefuldesk.mobile.push-installation-id';
export const EXPLANATION_KEY = 'usefuldesk.mobile.push-explanation-shown';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StorageAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface InstallationStorage {
  getOrCreateId(): Promise<string>;
  wasExplanationShown(): Promise<boolean>;
  markExplanationShown(): Promise<void>;
}

export function createInstallationStorage(
  storage: StorageAdapter,
  createUuid: () => string = () => globalThis.crypto.randomUUID()
): InstallationStorage {
  let operationTail = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    getOrCreateId: () =>
      enqueue(async () => {
        const existing = await storage.getItemAsync(INSTALLATION_ID_KEY);
        if (existing && UUID.test(existing)) return existing;
        const id = createUuid();
        if (!UUID.test(id)) throw new Error('Could not create installation id');
        await storage.setItemAsync(INSTALLATION_ID_KEY, id);
        return id;
      }),
    wasExplanationShown: () =>
      enqueue(
        async () => (await storage.getItemAsync(EXPLANATION_KEY)) === 'true'
      ),
    markExplanationShown: () =>
      enqueue(() => storage.setItemAsync(EXPLANATION_KEY, 'true')),
  };
}

export const installationStorage = createInstallationStorage(SecureStore);
