import * as SecureStore from 'expo-secure-store';

export const SELECTED_BRANCH_KEY = 'usefuldesk.mobile.selected-branch';

export interface BranchPreference {
  get(): Promise<string | null>;
  set(id: string): Promise<void>;
  clear(): Promise<void>;
}

interface BranchPreferenceStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export function createBranchPreference(
  storage: BranchPreferenceStorage
): BranchPreference {
  let operationTail = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    get: () => enqueue(() => storage.getItemAsync(SELECTED_BRANCH_KEY)),
    set: (id) => enqueue(() => storage.setItemAsync(SELECTED_BRANCH_KEY, id)),
    clear: () => enqueue(() => storage.deleteItemAsync(SELECTED_BRANCH_KEY)),
  };
}

export const branchPreference = createBranchPreference(SecureStore);
