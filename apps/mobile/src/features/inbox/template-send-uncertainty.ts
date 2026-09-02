import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'usefuldesk.template-send-uncertain.v1';
const MARKER_VALUE = '1';

export interface TemplateSendUncertaintyStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

function markerKey(accountId: string, conversationId: string): string {
  return `${KEY_PREFIX}.${accountId}.${conversationId}`;
}

export function createTemplateSendUncertaintyStore(
  storage: TemplateSendUncertaintyStorage
) {
  return {
    async hasMarker(accountId: string, conversationId: string) {
      return (
        (await storage.getItemAsync(markerKey(accountId, conversationId))) !==
        null
      );
    },
    async mark(accountId: string, conversationId: string) {
      await storage.setItemAsync(
        markerKey(accountId, conversationId),
        MARKER_VALUE
      );
    },
    async clear(accountId: string, conversationId: string) {
      await storage.deleteItemAsync(markerKey(accountId, conversationId));
    },
  };
}

export const templateSendUncertaintyStore =
  createTemplateSendUncertaintyStore(SecureStore);
