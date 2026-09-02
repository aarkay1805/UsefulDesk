import { createTemplateSendUncertaintyStore } from './template-send-uncertainty';

const ACCOUNT_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';

function adapter() {
  return {
    getItemAsync: jest.fn<Promise<string | null>, [string]>(),
    setItemAsync: jest.fn<Promise<void>, [string, string]>(),
    deleteItemAsync: jest.fn<Promise<void>, [string]>(),
  };
}

describe('template send uncertainty store', () => {
  it('stores only a scoped marker and treats any present value as uncertain', async () => {
    const storage = adapter();
    storage.setItemAsync.mockResolvedValue(undefined);
    storage.getItemAsync.mockResolvedValue('1');
    const store = createTemplateSendUncertaintyStore(storage);

    await store.mark(ACCOUNT_ID, CONVERSATION_ID);
    await expect(store.hasMarker(ACCOUNT_ID, CONVERSATION_ID)).resolves.toBe(
      true
    );

    expect(storage.setItemAsync).toHaveBeenCalledWith(
      `usefuldesk.template-send-uncertain.v1.${ACCOUNT_ID}.${CONVERSATION_ID}`,
      '1'
    );
  });

  it('reports a missing scoped marker as clear and deletes only that scope', async () => {
    const storage = adapter();
    storage.getItemAsync.mockResolvedValue(null);
    storage.deleteItemAsync.mockResolvedValue(undefined);
    const store = createTemplateSendUncertaintyStore(storage);

    await expect(store.hasMarker(ACCOUNT_ID, CONVERSATION_ID)).resolves.toBe(
      false
    );
    await store.clear(ACCOUNT_ID, CONVERSATION_ID);

    expect(storage.deleteItemAsync).toHaveBeenCalledWith(
      `usefuldesk.template-send-uncertain.v1.${ACCOUNT_ID}.${CONVERSATION_ID}`
    );
  });

  it.each(['read', 'write', 'delete'] as const)(
    'propagates %s failures so callers can fail closed',
    async (operation) => {
      const storage = adapter();
      const failure = new Error(`${operation} failed`);
      storage.getItemAsync.mockResolvedValue(null);
      storage.setItemAsync.mockResolvedValue(undefined);
      storage.deleteItemAsync.mockResolvedValue(undefined);
      if (operation === 'read') storage.getItemAsync.mockRejectedValue(failure);
      if (operation === 'write')
        storage.setItemAsync.mockRejectedValue(failure);
      if (operation === 'delete')
        storage.deleteItemAsync.mockRejectedValue(failure);
      const store = createTemplateSendUncertaintyStore(storage);

      const attempt =
        operation === 'read'
          ? store.hasMarker(ACCOUNT_ID, CONVERSATION_ID)
          : operation === 'write'
            ? store.mark(ACCOUNT_ID, CONVERSATION_ID)
            : store.clear(ACCOUNT_ID, CONVERSATION_ID);

      await expect(attempt).rejects.toBe(failure);
    }
  );
});
