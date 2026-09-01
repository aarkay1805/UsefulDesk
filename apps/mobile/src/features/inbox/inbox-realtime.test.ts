import {
  subscribeToInboxRealtime,
  type InboxRealtimeClient,
} from './inbox-realtime';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_1_ID,
  OTHER_BRANCH_ID,
} from './inbox-test-fixtures';

function fakeRealtimeClient() {
  let statusHandler: ((status: string) => void) | null = null;
  let payloadHandler: ((payload: unknown) => void) | null = null;
  let channel: { on: jest.Mock; subscribe: jest.Mock };
  channel = {
    on: jest.fn(
      (
        _kind: 'broadcast',
        _registration: { event: 'inbox_change' },
        callback: (payload: unknown) => void
      ) => {
        payloadHandler = callback;
        return channel;
      }
    ),
    subscribe: jest.fn((handler: (status: string) => void) => {
      statusHandler = handler;
      return channel;
    }),
  };
  return {
    broadcastOn: channel.on,
    realtime: { setAuth: jest.fn().mockResolvedValue(undefined) },
    channel: jest.fn(() => channel),
    removeChannel: jest.fn().mockResolvedValue('ok'),
    emitStatus(status: string) {
      statusHandler?.(status);
    },
    emit(payload: unknown) {
      payloadHandler?.(payload);
    },
  };
}

describe('subscribeToInboxRealtime', () => {
  it('authenticates before joining one private account topic and accepts identifier events', async () => {
    const client = fakeRealtimeClient();
    const onEvent = jest.fn();

    await subscribeToInboxRealtime({
      client: client as InboxRealtimeClient,
      accountId: BRANCH_ID,
      onEvent,
      onConnectionChange: jest.fn(),
    });

    expect(client.realtime.setAuth).toHaveBeenCalledTimes(1);
    expect(client.realtime.setAuth.mock.invocationCallOrder[0]).toBeLessThan(
      client.channel.mock.invocationCallOrder[0]!
    );
    expect(client.channel).toHaveBeenCalledWith(`account:${BRANCH_ID}`, {
      config: { private: true },
    });
    expect(client.broadcastOn).toHaveBeenCalledWith(
      'broadcast',
      { event: 'inbox_change' },
      expect.any(Function)
    );

    client.emit({
      payload: {
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      },
    });

    expect(onEvent).toHaveBeenCalledWith({
      table: 'messages',
      eventType: 'INSERT',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    });

    client.emit({
      payload: {
        table: 'messages',
        eventType: 'INSERT',
        accountId: OTHER_BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      },
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    { payload: null },
    {
      payload: {
        table: 'contacts',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      },
    },
    {
      payload: {
        table: 'messages',
        eventType: 'UPSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      },
    },
    {
      payload: {
        table: 'messages',
        eventType: 'INSERT',
        accountId: 'not-a-uuid',
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      },
    },
    {
      payload: {
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: 'not-a-uuid',
        messageId: MESSAGE_1_ID,
      },
    },
    {
      payload: {
        table: 'messages',
        eventType: 'INSERT',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      },
    },
    {
      payload: {
        table: 'conversations',
        eventType: 'UPDATE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      },
    },
  ])('ignores a malformed or non-identifier payload %#', async (payload) => {
    const client = fakeRealtimeClient();
    const onEvent = jest.fn();
    await subscribeToInboxRealtime({
      client: client as InboxRealtimeClient,
      accountId: BRANCH_ID,
      onEvent,
      onConnectionChange: jest.fn(),
    });

    client.emit(payload);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('accepts a conversation event only when its message identifier is null', async () => {
    const client = fakeRealtimeClient();
    const onEvent = jest.fn();
    await subscribeToInboxRealtime({
      client: client as InboxRealtimeClient,
      accountId: BRANCH_ID,
      onEvent,
      onConnectionChange: jest.fn(),
    });

    client.emit({
      payload: {
        table: 'conversations',
        eventType: 'DELETE',
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: null,
      },
    });

    expect(onEvent).toHaveBeenCalledWith({
      table: 'conversations',
      eventType: 'DELETE',
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: null,
    });
  });

  it('maps fixed channel statuses without exposing error objects', async () => {
    const client = fakeRealtimeClient();
    const onConnectionChange = jest.fn();
    await subscribeToInboxRealtime({
      client: client as InboxRealtimeClient,
      accountId: BRANCH_ID,
      onEvent: jest.fn(),
      onConnectionChange,
    });

    expect(onConnectionChange).toHaveBeenCalledWith('connecting');
    client.emitStatus('SUBSCRIBED');
    client.emitStatus('CHANNEL_ERROR');
    client.emitStatus('TIMED_OUT');
    client.emitStatus('CLOSED');
    client.emitStatus('UNRECOGNIZED');

    expect(onConnectionChange.mock.calls).toEqual([
      ['connecting'],
      ['connected'],
      ['disconnected'],
      ['disconnected'],
      ['disconnected'],
    ]);
  });

  it('removes the channel once when cleanup is repeated', async () => {
    const client = fakeRealtimeClient();
    const unsubscribe = await subscribeToInboxRealtime({
      client: client as InboxRealtimeClient,
      accountId: BRANCH_ID,
      onEvent: jest.fn(),
      onConnectionChange: jest.fn(),
    });

    await unsubscribe();
    await unsubscribe();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
