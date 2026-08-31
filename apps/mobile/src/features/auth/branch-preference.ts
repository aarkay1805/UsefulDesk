import * as SecureStore from 'expo-secure-store';

const SELECTED_BRANCH_KEY = 'usefuldesk.mobile.selected-branch';

export interface BranchPreference {
  get(): Promise<string | null>;
  set(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const branchPreference: BranchPreference = {
  get: () => SecureStore.getItemAsync(SELECTED_BRANCH_KEY),
  set: (id) => SecureStore.setItemAsync(SELECTED_BRANCH_KEY, id),
  clear: () => SecureStore.deleteItemAsync(SELECTED_BRANCH_KEY),
};
