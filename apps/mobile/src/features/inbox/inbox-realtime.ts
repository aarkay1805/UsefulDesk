import { mobileSupabase } from '../../data/supabase';

export type InboxConnectionState = 'connecting' | 'connected' | 'disconnected';

export type InboxRealtimeEvent =
  | {
      table: 'conversations';
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      accountId: string;
      conversationId: string;
      messageId: null;
    }
  | {
      table: 'messages';
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      accountId: string;
      conversationId: string;
      messageId: string;
    }
  | {
      table: 'message_reactions';
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      accountId: string;
      conversationId: string;
      messageId: string;
    };

export interface InboxRealtimeChannel {
  on(
    kind: 'broadcast',
    registration: { event: 'inbox_change' },
    callback: (payload: unknown) => void
  ): InboxRealtimeChannel;
  subscribe(callback: (status: string) => void): InboxRealtimeChannel;
}

export interface InboxRealtimeClient {
  realtime: { setAuth(): Promise<void> };
  channel(
    name: string,
    options: { config: { private: true } }
  ): InboxRealtimeChannel;
  removeChannel(channel: InboxRealtimeChannel): Promise<unknown>;
}

export interface SubscribeInboxRealtimeOptions {
  client?: InboxRealtimeClient;
  accountId: string;
  onEvent(event: InboxRealtimeEvent): void;
  onConnectionChange(state: InboxConnectionState): void;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseEvent(
  envelope: unknown,
  selectedAccountId: string
): InboxRealtimeEvent | null {
  if (!isRecord(envelope) || !isRecord(envelope.payload)) return null;

  const payload = envelope.payload;
  const { table, eventType, accountId, conversationId, messageId } = payload;
  if (
    (eventType !== 'INSERT' &&
      eventType !== 'UPDATE' &&
      eventType !== 'DELETE') ||
    !isUuid(accountId) ||
    accountId !== selectedAccountId ||
    !isUuid(conversationId)
  ) {
    return null;
  }

  if (table === 'conversations' && messageId === null) {
    return { table, eventType, accountId, conversationId, messageId };
  }
  if (
    (table === 'messages' || table === 'message_reactions') &&
    isUuid(messageId)
  ) {
    return { table, eventType, accountId, conversationId, messageId };
  }
  return null;
}

function connectionStateForStatus(status: string): InboxConnectionState | null {
  if (status === 'SUBSCRIBED') return 'connected';
  if (
    status === 'CHANNEL_ERROR' ||
    status === 'TIMED_OUT' ||
    status === 'CLOSED'
  ) {
    return 'disconnected';
  }
  return null;
}

export async function subscribeToInboxRealtime(
  options: SubscribeInboxRealtimeOptions
): Promise<() => Promise<void>> {
  const client =
    options.client ?? (mobileSupabase as unknown as InboxRealtimeClient);
  let active = true;
  let removed = false;

  options.onConnectionChange('connecting');
  await client.realtime.setAuth();

  const channel = client.channel(`account:${options.accountId}`, {
    config: { private: true },
  });
  channel
    .on('broadcast', { event: 'inbox_change' }, (envelope) => {
      if (!active) return;
      const event = parseEvent(envelope, options.accountId);
      if (event) options.onEvent(event);
    })
    .subscribe((status) => {
      if (!active) return;
      const state = connectionStateForStatus(status);
      if (state) options.onConnectionChange(state);
    });

  return async () => {
    if (removed) return;
    removed = true;
    active = false;
    await client.removeChannel(channel);
  };
}
