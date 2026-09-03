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
  /** Local-only display name while an optimistic document send is pending. */
  mediaFilename?: string | null;
  templateName: string | null;
  providerMessageId: string | null;
  status: MessageStatus;
  providerErrorTitle: string | null;
  /** Local-only proof that a failed optimistic send was rejected pre-send. */
  safeToRetry?: boolean;
  createdAt: string;
  replyToMessageId: string | null;
  interactiveReplyId: string | null;
}
export type ReactionActor = 'customer' | 'agent';
export interface InboxMessageReaction {
  id: string;
  messageId: string;
  conversationId: string;
  actorType: ReactionActor;
  actorId: string;
  emoji: string;
  createdAt: string;
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

export type NativeTemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phoneNumber: string }
  | { type: 'COPY_CODE'; text: string; example: string };

export interface NativeTemplate {
  id: string;
  name: string;
  language: string;
  category: 'Marketing' | 'Utility';
  bodyText: string;
  headerType: 'text' | null;
  headerContent: string | null;
  headerMediaUrl: null;
  buttons: NativeTemplateButton[];
  status: 'APPROVED';
  parameterFormat: 'POSITIONAL';
  providerMissingSince: null;
  providerComponentsSyncRequiredAt: null;
}

export type TemplateField =
  | { kind: 'body'; variable: number; label: `Body variable ${number}` }
  | { kind: 'header'; variable: 1; label: 'Header variable' }
  | {
      kind: 'button';
      buttonIndex: number;
      label: string;
      defaultValue?: string;
    };

export interface ConnectionReadiness {
  status: 'absent' | 'disconnected' | 'connected';
  ready: boolean;
  reason: string | null;
  connectedAt: string | null;
}
