import type {
  ContentType,
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  MessageStatus,
  SenderType,
} from './inbox-types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<ConversationStatus>(['open', 'pending', 'closed']);
const senders = new Set<SenderType>(['customer', 'agent', 'bot']);
const contentTypes = new Set<ContentType>([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);
const messageStatuses = new Set<MessageStatus>([
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
]);
const invalidConversation = (): never => {
  throw new Error('Invalid conversation row');
};
const invalidMessage = (): never => {
  throw new Error('Invalid message row');
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const string = (value: unknown, nullable = false): string | null =>
  typeof value === 'string' ? value : nullable && value === null ? null : null;
const validString = (
  value: unknown,
  nullable = false
): value is string | null =>
  typeof value === 'string' || (nullable && value === null);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);
const iso = (value: unknown, nullable = false): value is string | null =>
  (nullable && value === null) ||
  (typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)));
const nullableUuid = (value: unknown): value is string | null =>
  value === null || uuid(value);

export function parseConversationRows(
  rows: unknown[],
  accountId: string
): InboxConversation[] {
  if (!Array.isArray(rows) || !uuid(accountId)) invalidConversation();
  return rows.map((row) => {
    const r = object(row);
    const contact = r && object(r.contact);
    if (!r || !contact || !Array.isArray(contact.memberships))
      return invalidConversation();
    const normalized = r as Record<string, unknown>;
    const embeddedContact = contact as Record<string, unknown>;
    if (
      !uuid(normalized.id) ||
      normalized.account_id !== accountId ||
      !uuid(normalized.account_id) ||
      !uuid(normalized.contact_id) ||
      !uuid(embeddedContact.id) ||
      embeddedContact.id !== normalized.contact_id ||
      !validString(embeddedContact.name, true) ||
      typeof embeddedContact.phone !== 'string' ||
      !validString(embeddedContact.avatar_url, true) ||
      !statuses.has(normalized.status as ConversationStatus) ||
      !nullableUuid(normalized.assigned_agent_id) ||
      !validString(normalized.last_message_text, true) ||
      !iso(normalized.last_message_at, true) ||
      !Number.isFinite(normalized.unread_count) ||
      typeof normalized.unread_count !== 'number' ||
      normalized.unread_count < 0 ||
      !iso(normalized.created_at) ||
      !iso(normalized.updated_at)
    )
      return invalidConversation();
    return {
      id: normalized.id as string,
      accountId: normalized.account_id as string,
      contactId: normalized.contact_id as string,
      status: normalized.status as ConversationStatus,
      assignedAgentId: normalized.assigned_agent_id as string | null,
      lastMessageText: string(normalized.last_message_text, true),
      lastMessageAt: string(normalized.last_message_at, true),
      unreadCount: normalized.unread_count as number,
      createdAt: normalized.created_at as string,
      updatedAt: normalized.updated_at as string,
      contact: {
        id: embeddedContact.id as string,
        name: string(embeddedContact.name, true),
        phone: embeddedContact.phone as string,
        avatarUrl: string(embeddedContact.avatar_url, true),
      },
      isMember: (embeddedContact.memberships as unknown[]).length > 0,
    };
  });
}

export function parseMessageRows(
  rows: unknown[],
  conversationId: string
): InboxMessage[] {
  if (!Array.isArray(rows) || !uuid(conversationId)) invalidMessage();
  return rows.map((row) => {
    const r = object(row);
    if (!r) return invalidMessage();
    const normalized = r as Record<string, unknown>;
    if (
      !uuid(normalized.id) ||
      normalized.conversation_id !== conversationId ||
      !uuid(normalized.conversation_id) ||
      !senders.has(normalized.sender_type as SenderType) ||
      !nullableUuid(normalized.sender_id) ||
      !contentTypes.has(normalized.content_type as ContentType) ||
      !validString(normalized.content_text, true) ||
      !validString(normalized.media_url, true) ||
      !validString(normalized.template_name, true) ||
      !validString(normalized.message_id, true) ||
      !messageStatuses.has(normalized.status as MessageStatus) ||
      !validString(normalized.provider_error_title, true) ||
      !iso(normalized.created_at) ||
      !nullableUuid(normalized.reply_to_message_id) ||
      !validString(normalized.interactive_reply_id, true)
    )
      return invalidMessage();
    return {
      id: normalized.id as string,
      conversationId: normalized.conversation_id as string,
      senderType: normalized.sender_type as SenderType,
      senderId: normalized.sender_id as string | null,
      contentType: normalized.content_type as ContentType,
      contentText: string(normalized.content_text, true),
      mediaUrl: string(normalized.media_url, true),
      templateName: string(normalized.template_name, true),
      providerMessageId: string(normalized.message_id, true),
      status: normalized.status as MessageStatus,
      providerErrorTitle: string(normalized.provider_error_title, true),
      createdAt: normalized.created_at as string,
      replyToMessageId: normalized.reply_to_message_id as string | null,
      interactiveReplyId: string(normalized.interactive_reply_id, true),
    };
  });
}
