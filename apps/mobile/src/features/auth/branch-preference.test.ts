import {
  createBranchPreference,
  SELECTED_BRANCH_KEY,
} from './branch-preference';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('createBranchPreference', () => {
  it('uses one exact non-secret preference key', async () => {
    const adapter = {
      getItemAsync: jest.fn().mockResolvedValue('branch-a'),
      setItemAsync: jest.fn().mockResolvedValue(undefined),
      deleteItemAsync: jest.fn().mockResolvedValue(undefined),
    };
    const preference = createBranchPreference(adapter);

    await preference.get();
    await preference.set('branch-b');
    await preference.clear();

    expect(adapter.getItemAsync).toHaveBeenCalledWith(SELECTED_BRANCH_KEY);
    expect(adapter.setItemAsync).toHaveBeenCalledWith(
      SELECTED_BRANCH_KEY,
      'branch-b'
    );
    expect(adapter.deleteItemAsync).toHaveBeenCalledWith(SELECTED_BRANCH_KEY);
  });

  it('orders sign-out cleanup after an already-started branch write', async () => {
    const values = new Map<string, string>();
    const writeStarted = deferred();
    const finishWrite = deferred();
    const adapter = {
      getItemAsync: async (key: string) => values.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        writeStarted.resolve();
        await finishWrite.promise;
        values.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        values.delete(key);
      },
    };
    const preference = createBranchPreference(adapter);

    const staleWrite = preference.set('branch-b');
    await writeStarted.promise;
    const signOutClear = preference.clear();
    finishWrite.resolve();
    await staleWrite;
    await signOutClear;

    expect(values.has(SELECTED_BRANCH_KEY)).toBe(false);
  });
});
