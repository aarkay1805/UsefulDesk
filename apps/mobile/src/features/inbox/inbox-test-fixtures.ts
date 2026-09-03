import type { ConversationRepository } from './conversation-repository';
import type { InboxRealtimeFeed } from './inbox-realtime-provider';
import type { SessionWindowMessageRepository } from './message-repository';
import type { ReactionRepository } from './reaction-repository';
import type { TemplateRepository } from './template-repository';
import type {
  MessageThreadOutboundDependencies,
  UseMessageThreadOptions,
} from './use-message-thread';
import type { InboxConversation, InboxMessage, Page } from './inbox-types';

export const BRANCH_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
export const OTHER_BRANCH_ID = 'ab92ad08-3808-4a3e-8d50-7a5fa2a6a770';
export const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';
export const EMPTY_CONVERSATION_ID = 'dc046770-c5f6-4f2a-98c5-a60786a312b9';
export const OTHER_CONVERSATION_ID = '926c8f7b-b1b9-45da-a65e-3a5511159f87';
export const CONTACT_ID = 'ba8df73d-a33e-4236-a93b-357149bc6ea0';
export const MESSAGE_0_ID = '41a29fc1-6e83-41a0-872a-5ffb0def795f';
export const MESSAGE_1_ID = '94c45d67-692f-4654-8806-668858e84c6b';
export const MESSAGE_2_ID = '16b3b0cf-9ed9-41c5-860d-d11391712e92';
export const MESSAGE_3_ID = '0e6d616f-0b0e-438b-a210-3d05b8075de4';
export const ABSENT_MESSAGE_ID = '2ec92843-fe53-46ac-8751-df6f75e5908a';
export const LOCAL_LAYOUT_FIXTURE = 'local-layout';

export function rawConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    account_id: BRANCH_ID,
    contact_id: CONTACT_ID,
    status: 'open',
    assigned_agent_id: null,
    last_message_text: 'Your membership expires tomorrow',
    last_message_at: '2026-09-01T08:00:00.000Z',
    unread_count: 3,
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    contact: {
      id: CONTACT_ID,
      name: 'Asha Rao',
      phone: '9876543210',
      avatar_url: null,
      memberships: [{ id: 'd2e4e69f-4c98-4204-b2c6-f746ea672858' }],
    },
    ...overrides,
  };
}

export function conversation(
  overrides: Partial<InboxConversation> = {}
): InboxConversation {
  return {
    id: CONVERSATION_ID,
    accountId: BRANCH_ID,
    contactId: CONTACT_ID,
    status: 'open',
    assignedAgentId: null,
    lastMessageText: 'Your membership expires tomorrow',
    lastMessageAt: '2026-09-01T08:00:00.000Z',
    unreadCount: 3,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    contact: {
      id: CONTACT_ID,
      name: 'Asha Rao',
      phone: '9876543210',
      avatarUrl: null,
    },
    isMember: true,
    ...overrides,
  };
}

export function rawMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_1_ID,
    conversation_id: CONVERSATION_ID,
    sender_type: 'customer',
    sender_id: null,
    content_type: 'text',
    content_text: 'Hello',
    media_url: null,
    template_name: null,
    message_id: 'wamid.test',
    status: 'delivered',
    provider_error_title: null,
    created_at: '2026-09-01T08:01:00.000Z',
    reply_to_message_id: null,
    interactive_reply_id: null,
    ...overrides,
  };
}

export function message(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: MESSAGE_1_ID,
    conversationId: CONVERSATION_ID,
    senderType: 'customer',
    senderId: null,
    contentType: 'text',
    contentText: 'Hello',
    mediaUrl: null,
    templateName: null,
    providerMessageId: 'wamid.test',
    status: 'delivered',
    providerErrorTitle: null,
    createdAt: '2026-09-01T08:01:00.000Z',
    replyToMessageId: null,
    interactiveReplyId: null,
    ...overrides,
  };
}

export function page<T, C>(
  items: T[],
  nextCursor: C | null = null
): Page<T, C> {
  return { items, nextCursor };
}

interface LocalConversationLayoutFixture {
  outbound: MessageThreadOutboundDependencies;
  reactionDependencies: {
    repository: ReactionRepository;
    mutate(messageId: string, emoji: string): Promise<void>;
  };
  threadDependencies: Pick<
    UseMessageThreadOptions,
    'conversations' | 'messages' | 'templates' | 'realtime'
  >;
}

export function createLocalConversationLayoutFixture(
  accountId: string,
  senderId: string
): LocalConversationLayoutFixture {
  const now = Date.now();
  const firstInboundAt = new Date(now - 120_000).toISOString();
  const outboundAt = new Date(now - 60_000).toISOString();
  const latestInboundAt = new Date(now).toISOString();
  const fixtureConversation = conversation({
    accountId,
    unreadCount: 0,
    lastMessageAt: latestInboundAt,
    lastMessageText:
      'Thanks. Please share the available renewal options when you have a moment.',
    updatedAt: latestInboundAt,
    contact: {
      id: CONTACT_ID,
      name: 'Asha Rao · Local fixture',
      phone: '9876543210',
      avatarUrl: null,
    },
  });
  const fixtureMessages = [
    message({
      id: MESSAGE_0_ID,
      conversationId: CONVERSATION_ID,
      contentText:
        'Hi, I want to confirm the renewal details before my current plan ends tomorrow.',
      createdAt: firstInboundAt,
      senderType: 'customer',
      status: 'delivered',
    }),
    message({
      id: MESSAGE_1_ID,
      conversationId: CONVERSATION_ID,
      contentText:
        'Absolutely — your membership can continue without a break. I can help with the next steps here.',
      createdAt: outboundAt,
      senderId,
      senderType: 'agent',
      status: 'read',
    }),
    message({
      id: MESSAGE_2_ID,
      conversationId: CONVERSATION_ID,
      contentText:
        'Thanks. Please share the available renewal options when you have a moment.',
      createdAt: latestInboundAt,
      senderType: 'customer',
      status: 'delivered',
    }),
  ];

  const requireScope = (requestedAccountId: string, conversationId: string) => {
    if (
      requestedAccountId !== accountId ||
      conversationId !== CONVERSATION_ID
    ) {
      throw new Error('Conversation is unavailable');
    }
  };

  const conversations: ConversationRepository = {
    async list() {
      return page([fixtureConversation]);
    },
    async unreadCount() {
      return 0;
    },
    async get(requestedAccountId, conversationId) {
      requireScope(requestedAccountId, conversationId);
      return fixtureConversation;
    },
    async markRead(requestedAccountId, conversationId) {
      requireScope(requestedAccountId, conversationId);
    },
  };
  const messages: SessionWindowMessageRepository = {
    async list(input) {
      requireScope(input.accountId, input.conversationId);
      return page(fixtureMessages);
    },
    async get(requestedAccountId, conversationId, messageId) {
      requireScope(requestedAccountId, conversationId);
      const fixtureMessage = fixtureMessages.find(
        (candidate) => candidate.id === messageId
      );
      if (!fixtureMessage) throw new Error('Message is unavailable');
      return fixtureMessage;
    },
    async getLatestCustomerMessageAt(requestedAccountId, conversationId) {
      requireScope(requestedAccountId, conversationId);
      return latestInboundAt;
    },
  };
  const templates: TemplateRepository = {
    async listSendableTemplates() {
      return [];
    },
    async getWhatsAppConnectionReadiness(requestedAccountId) {
      if (requestedAccountId !== accountId) {
        throw new Error('Send readiness is unavailable');
      }
      return {
        status: 'connected',
        ready: true,
        reason: null,
        connectedAt: latestInboundAt,
      };
    },
  };
  const realtime: InboxRealtimeFeed = {
    getSnapshot: () => ({ connection: 'connected', resyncGeneration: 0 }),
    listen: () => () => undefined,
    listenStatus: () => () => undefined,
  };
  const reactionDependencies = {
    repository: {
      async list(requestedAccountId: string, conversationId: string) {
        requireScope(requestedAccountId, conversationId);
        return [
          {
            id: 'a35c23ac-66f4-4476-9adb-173a12b2fd31',
            messageId: MESSAGE_0_ID,
            conversationId,
            actorType: 'customer' as const,
            actorId: CONTACT_ID,
            emoji: '👍',
            createdAt: firstInboundAt,
          },
        ];
      },
    },
    async mutate(messageId: string, _emoji: string) {
      if (!fixtureMessages.some((candidate) => candidate.id === messageId)) {
        throw new Error('Message is unavailable');
      }
    },
  };

  return {
    outbound: {
      senderId,
      recoverUnauthorizedSession: async () => undefined,
      sendMessage: async () => {
        throw new Error('Local layout fixture cannot send messages');
      },
    },
    reactionDependencies,
    threadDependencies: { conversations, messages, realtime, templates },
  };
}
