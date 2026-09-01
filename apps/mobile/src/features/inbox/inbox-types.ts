export type ConversationStatus = 'open' | 'pending' | 'closed';
export type SenderType = 'customer' | 'agent' | 'bot';
export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  | 'interactive';
export type MessageStatus =
  'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface InboxContact {
  id: string;
  name: string | null;
  phone: string;
  avatarUrl: string | null;
}
export interface InboxConversation {
  id: string;
  accountId: string;
  contactId: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  contact: InboxContact;
  isMember: boolean;
}
export interface InboxMessage {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string | null;
  contentType: ContentType;
  contentText: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  providerMessageId: string | null;
  status: MessageStatus;
  providerErrorTitle: string | null;
  createdAt: string;
  replyToMessageId: string | null;
  interactiveReplyId: string | null;
}
export type ConversationCursor =
  | { phase: 'messaged'; lastMessageAt: string; id: string }
  | { phase: 'empty'; createdAt: string; id: string };
export interface MessageCursor {
  createdAt: string;
  id: string;
}
export interface Page<T, C> {
  items: T[];
  nextCursor: C | null;
}
export type ConversationFilter = 'all' | 'unread';
export type ThreadDisplayItem =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'message'; key: string; message: InboxMessage; startsRun: boolean };
