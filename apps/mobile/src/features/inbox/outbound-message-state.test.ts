import {
  appendOptimisticText,
  applyRealtimeMessage,
  applySendAcknowledgement,
  emptyOutboundThreadState,
  markOptimisticFailed,
} from './outbound-message-state';
import {
  CONVERSATION_ID,
  MESSAGE_1_ID,
  MESSAGE_2_ID,
  message,
} from './inbox-test-fixtures';

const TEMPORARY_ID = 'temp:one';
const PROVIDER_ID = 'wamid.one';
const CREATED_AT = '2026-09-01T08:03:00.000Z';

function optimistic(
  state = emptyOutboundThreadState(),
  temporaryId = TEMPORARY_ID
) {
  return appendOptimisticText(state, {
    temporaryId,
    conversationId: CONVERSATION_ID,
    senderId: '30250c1e-ee34-4af5-8752-2ad170d65713',
    text: 'See you tomorrow',
    createdAt: CREATED_AT,
  });
}

function persisted(status: 'sent' | 'delivered' | 'read' = 'sent') {
  return message({
    id: MESSAGE_1_ID,
    conversationId: CONVERSATION_ID,
    senderType: 'agent',
    senderId: '30250c1e-ee34-4af5-8752-2ad170d65713',
    contentType: 'text',
    contentText: 'See you tomorrow',
    providerMessageId: PROVIDER_ID,
    status,
    createdAt: CREATED_AT,
  });
}

describe('outbound message state', () => {
  it('appends an optimistic outbound text immediately as sending', () => {
    const state = optimistic();

    expect(state.messages).toEqual([
      expect.objectContaining({
        id: TEMPORARY_ID,
        conversationId: CONVERSATION_ID,
        senderType: 'agent',
        contentType: 'text',
        contentText: 'See you tomorrow',
        providerMessageId: null,
        status: 'sending',
        createdAt: CREATED_AT,
      }),
    ]);
    expect(state.aliases.temporaryId[TEMPORARY_ID]).toBe(TEMPORARY_ID);
  });

  it('reconciles an API acknowledgement before its realtime insert into one row', () => {
    let state = optimistic();
    state = applySendAcknowledgement(state, {
      temporaryId: TEMPORARY_ID,
      messageId: MESSAGE_1_ID,
      whatsappMessageId: PROVIDER_ID,
    });
    state = applyRealtimeMessage(state, persisted('delivered'));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        id: MESSAGE_1_ID,
        providerMessageId: PROVIDER_ID,
        status: 'delivered',
      })
    );
    expect(state.aliases.temporaryId[TEMPORARY_ID]).toBe(MESSAGE_1_ID);
  });

  it('reconciles a realtime insert before its API acknowledgement into one row', () => {
    let state = optimistic();
    state = applyRealtimeMessage(state, persisted());
    state = applySendAcknowledgement(state, {
      temporaryId: TEMPORARY_ID,
      messageId: MESSAGE_1_ID,
      whatsappMessageId: PROVIDER_ID,
    });

    expect(
      state.messages.filter((item) => item.senderType !== 'customer')
    ).toHaveLength(1);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({ id: MESSAGE_1_ID, status: 'sent' })
    );
  });

  it('deduplicates repeated realtime inserts by persisted message ID', () => {
    let state = applyRealtimeMessage(emptyOutboundThreadState(), persisted());
    state = applyRealtimeMessage(state, persisted('delivered'));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].status).toBe('delivered');
  });

  it('matches a later realtime row through its persisted ID alias', () => {
    let state = applySendAcknowledgement(optimistic(), {
      temporaryId: TEMPORARY_ID,
      messageId: MESSAGE_1_ID,
      whatsappMessageId: null,
    });
    state = applyRealtimeMessage(state, persisted('delivered'));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].status).toBe('delivered');
  });

  it('matches a later realtime row through its provider ID alias', () => {
    const firstProviderRow = persisted();
    let state = applyRealtimeMessage(
      emptyOutboundThreadState(),
      firstProviderRow
    );
    state = applyRealtimeMessage(state, {
      ...persisted('read'),
      id: MESSAGE_2_ID,
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].status).toBe('read');
    expect(state.aliases.whatsappMessageId[PROVIDER_ID]).toBe(MESSAGE_1_ID);
  });

  it('patches later delivery and read updates onto the same logical row', () => {
    let state = applyRealtimeMessage(optimistic(), persisted('delivered'));
    state = applySendAcknowledgement(state, {
      temporaryId: TEMPORARY_ID,
      messageId: MESSAGE_1_ID,
      whatsappMessageId: PROVIDER_ID,
    });
    state = applyRealtimeMessage(state, persisted('read'));
    state = applyRealtimeMessage(state, persisted('sent'));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].status).toBe('read');
  });

  it('keeps a failed optimistic row visible', () => {
    const state = markOptimisticFailed(
      optimistic(),
      TEMPORARY_ID,
      'Could not send'
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        id: TEMPORARY_ID,
        status: 'failed',
        providerErrorTitle: 'Could not send',
      })
    );
  });

  it('retries through the same temporary row instead of appending', () => {
    const failed = markOptimisticFailed(
      optimistic(),
      TEMPORARY_ID,
      'Could not send'
    );
    const retrying = optimistic(failed);

    expect(retrying.messages).toHaveLength(1);
    expect(retrying.messages[0]).toEqual(
      expect.objectContaining({
        id: TEMPORARY_ID,
        status: 'sending',
        providerErrorTitle: null,
      })
    );
  });

  it('appends an unrelated inbound realtime insert', () => {
    const inbound = message({
      id: MESSAGE_2_ID,
      senderType: 'customer',
      providerMessageId: 'wamid.customer',
      createdAt: '2026-09-01T08:04:00.000Z',
    });
    const state = applyRealtimeMessage(optimistic(), inbound);

    expect(state.messages.map((item) => item.id)).toEqual([
      TEMPORARY_ID,
      MESSAGE_2_ID,
    ]);
  });
});
