import type { InboxMessage, MessageStatus } from './inbox-types';

export interface OutboundMessageAliases {
  temporaryId: Readonly<Record<string, string>>;
  messageId: Readonly<Record<string, string>>;
  whatsappMessageId: Readonly<Record<string, string>>;
}

export interface OutboundThreadState {
  messages: InboxMessage[];
  aliases: OutboundMessageAliases;
}

export interface OptimisticTextInput {
  temporaryId: string;
  conversationId: string;
  senderId: string | null;
  text: string;
  createdAt: string;
}

export interface SendAcknowledgement {
  temporaryId: string;
  messageId: string;
  whatsappMessageId: string | null;
}

const statusRank: Record<MessageStatus, number> = {
  failed: -1,
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function emptyOutboundThreadState(
  messages: InboxMessage[] = []
): OutboundThreadState {
  return {
    messages,
    aliases: {
      temporaryId: {},
      messageId: {},
      whatsappMessageId: {},
    },
  };
}

function compareMessages(first: InboxMessage, second: InboxMessage): number {
  if (first.createdAt !== second.createdAt) {
    return first.createdAt.localeCompare(second.createdAt);
  }
  return first.id.localeCompare(second.id);
}

function aliasValuesFor(
  aliases: OutboundMessageAliases,
  canonicalIds: ReadonlySet<string>,
  nextCanonicalId: string
): OutboundMessageAliases {
  const rewrite = (source: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(source).map(([alias, canonicalId]) => [
        alias,
        canonicalIds.has(canonicalId) ? nextCanonicalId : canonicalId,
      ])
    );
  return {
    temporaryId: rewrite(aliases.temporaryId),
    messageId: rewrite(aliases.messageId),
    whatsappMessageId: rewrite(aliases.whatsappMessageId),
  };
}

function canonicalForMessage(
  state: OutboundThreadState,
  item: InboxMessage
): string {
  return (
    state.aliases.messageId[item.id] ??
    state.aliases.temporaryId[item.id] ??
    (item.providerMessageId
      ? state.aliases.whatsappMessageId[item.providerMessageId]
      : undefined) ??
    item.id
  );
}

function higherStatus(
  first: MessageStatus,
  second: MessageStatus
): MessageStatus {
  return statusRank[second] > statusRank[first] ? second : first;
}

function mergeMessage(
  current: InboxMessage,
  incoming: InboxMessage,
  canonicalId: string
): InboxMessage {
  const status = higherStatus(current.status, incoming.status);
  return {
    ...current,
    ...incoming,
    id: canonicalId,
    status,
    providerErrorTitle:
      status === 'failed'
        ? (incoming.providerErrorTitle ?? current.providerErrorTitle)
        : null,
  };
}

function mergeLogicalRows(
  state: OutboundThreadState,
  canonicalIds: ReadonlySet<string>,
  canonicalId: string,
  incoming?: InboxMessage
): { messages: InboxMessage[]; merged: InboxMessage | null } {
  let merged: InboxMessage | null = null;
  const messages: InboxMessage[] = [];
  state.messages.forEach((item) => {
    if (!canonicalIds.has(canonicalForMessage(state, item))) {
      messages.push(item);
      return;
    }
    merged = merged
      ? mergeMessage(merged, item, canonicalId)
      : { ...item, id: canonicalId };
  });
  if (incoming) {
    merged = merged
      ? mergeMessage(merged, incoming, canonicalId)
      : { ...incoming, id: canonicalId };
  }
  if (merged) messages.push(merged);
  return { messages: messages.sort(compareMessages), merged };
}

export function appendOptimisticText(
  state: OutboundThreadState,
  input: OptimisticTextInput
): OutboundThreadState {
  const canonicalId =
    state.aliases.temporaryId[input.temporaryId] ?? input.temporaryId;
  const index = state.messages.findIndex(
    (item) => canonicalForMessage(state, item) === canonicalId
  );
  const optimistic: InboxMessage = {
    id: input.temporaryId,
    conversationId: input.conversationId,
    senderType: 'agent',
    senderId: input.senderId,
    contentType: 'text',
    contentText: input.text,
    mediaUrl: null,
    templateName: null,
    providerMessageId: null,
    status: 'sending',
    providerErrorTitle: null,
    createdAt: input.createdAt,
    replyToMessageId: null,
    interactiveReplyId: null,
  };
  const messages = [...state.messages];
  if (index < 0) {
    messages.push(optimistic);
  } else {
    messages[index] = {
      ...messages[index],
      status: 'sending',
      providerErrorTitle: null,
    };
  }
  return {
    messages: messages.sort(compareMessages),
    aliases: {
      ...state.aliases,
      temporaryId: {
        ...state.aliases.temporaryId,
        [input.temporaryId]: canonicalId,
      },
    },
  };
}

export function applySendAcknowledgement(
  state: OutboundThreadState,
  acknowledgement: SendAcknowledgement
): OutboundThreadState {
  const temporaryCanonical =
    state.aliases.temporaryId[acknowledgement.temporaryId] ??
    acknowledgement.temporaryId;
  const persistedCanonical =
    state.aliases.messageId[acknowledgement.messageId] ??
    acknowledgement.messageId;
  const providerCanonical = acknowledgement.whatsappMessageId
    ? state.aliases.whatsappMessageId[acknowledgement.whatsappMessageId]
    : undefined;
  const canonicalIds = new Set(
    [temporaryCanonical, persistedCanonical, providerCanonical].filter(
      (value): value is string => value !== undefined
    )
  );
  const aliases = aliasValuesFor(
    state.aliases,
    canonicalIds,
    acknowledgement.messageId
  );
  const { messages, merged } = mergeLogicalRows(
    state,
    canonicalIds,
    acknowledgement.messageId
  );
  const acknowledged = merged
    ? {
        ...merged,
        id: acknowledgement.messageId,
        providerMessageId:
          acknowledgement.whatsappMessageId ?? merged.providerMessageId,
        status: higherStatus(merged.status, 'sent'),
        providerErrorTitle: null,
      }
    : null;
  return {
    messages: acknowledged
      ? messages
          .map((item) =>
            item.id === acknowledgement.messageId ? acknowledged : item
          )
          .sort(compareMessages)
      : messages,
    aliases: {
      temporaryId: {
        ...aliases.temporaryId,
        [acknowledgement.temporaryId]: acknowledgement.messageId,
      },
      messageId: {
        ...aliases.messageId,
        [acknowledgement.messageId]: acknowledgement.messageId,
      },
      whatsappMessageId: acknowledgement.whatsappMessageId
        ? {
            ...aliases.whatsappMessageId,
            [acknowledgement.whatsappMessageId]: acknowledgement.messageId,
          }
        : aliases.whatsappMessageId,
    },
  };
}

export function applyRealtimeMessage(
  state: OutboundThreadState,
  item: InboxMessage
): OutboundThreadState {
  const persistedCanonical = state.aliases.messageId[item.id];
  const providerCanonical = item.providerMessageId
    ? state.aliases.whatsappMessageId[item.providerMessageId]
    : undefined;
  const canonicalId = persistedCanonical ?? providerCanonical ?? item.id;
  const canonicalIds = new Set(
    [canonicalId, persistedCanonical, providerCanonical].filter(
      (value): value is string => value !== undefined
    )
  );
  const aliases = aliasValuesFor(state.aliases, canonicalIds, canonicalId);
  const { messages } = mergeLogicalRows(state, canonicalIds, canonicalId, item);
  return {
    messages,
    aliases: {
      temporaryId: aliases.temporaryId,
      messageId: { ...aliases.messageId, [item.id]: canonicalId },
      whatsappMessageId: item.providerMessageId
        ? {
            ...aliases.whatsappMessageId,
            [item.providerMessageId]: canonicalId,
          }
        : aliases.whatsappMessageId,
    },
  };
}

export function markOptimisticFailed(
  state: OutboundThreadState,
  temporaryId: string,
  errorTitle: string
): OutboundThreadState {
  const canonicalId = state.aliases.temporaryId[temporaryId] ?? temporaryId;
  const messages = state.messages.map((item) =>
    canonicalForMessage(state, item) === canonicalId
      ? { ...item, status: 'failed' as const, providerErrorTitle: errorTitle }
      : item
  );
  return { ...state, messages };
}

export function hasTemporaryAliasForMessage(
  state: OutboundThreadState,
  messageId: string
): boolean {
  return Object.values(state.aliases.temporaryId).includes(messageId);
}

export function messageForTemporaryId(
  state: OutboundThreadState,
  temporaryId: string
): InboxMessage | null {
  const canonicalId = state.aliases.temporaryId[temporaryId] ?? temporaryId;
  return (
    state.messages.find(
      (item) => canonicalForMessage(state, item) === canonicalId
    ) ?? null
  );
}
