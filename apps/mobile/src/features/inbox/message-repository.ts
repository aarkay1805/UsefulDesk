import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import { parseMessageRows } from './inbox-normalizers';
import type { InboxMessage, MessageCursor, Page } from './inbox-types';

export const MESSAGE_PAGE_SIZE = 40;

const CONVERSATION_UNAVAILABLE = 'Conversation is unavailable';
const LOAD_ERROR = 'Could not load messages';
const MESSAGE_UNAVAILABLE = 'Message is unavailable';

export const MESSAGE_SELECT = `
  id,
  conversation_id,
  sender_type,
  sender_id,
  content_type,
  content_text,
  media_url,
  template_name,
  message_id,
  status,
  provider_error_title,
  created_at,
  reply_to_message_id,
  interactive_reply_id
`;

export interface ListMessagesInput {
  accountId: string;
  conversationId: string;
  cursor: MessageCursor | null;
  limit?: number;
}

export interface MessageRepository {
  list(input: ListMessagesInput): Promise<Page<InboxMessage, MessageCursor>>;
  get(
    accountId: string,
    conversationId: string,
    messageId: string
  ): Promise<InboxMessage>;
}

export interface MessageQuerySource {
  conversationExists(
    accountId: string,
    conversationId: string
  ): Promise<boolean>;
  listMessages(input: {
    accountId: string;
    conversationId: string;
    cursor: MessageCursor | null;
    limit: number;
  }): Promise<unknown[]>;
  findMessage(input: {
    accountId: string;
    conversationId: string;
    messageId: string;
  }): Promise<unknown | null>;
}

export function createMessageRepository(
  source: MessageQuerySource
): MessageRepository {
  return {
    async list(input) {
      try {
        if (
          !(await source.conversationExists(
            input.accountId,
            input.conversationId
          ))
        ) {
          throw new Error(CONVERSATION_UNAVAILABLE);
        }
        const limit = input.limit ?? MESSAGE_PAGE_SIZE;
        if (!Number.isInteger(limit) || limit < 1) throw new Error(LOAD_ERROR);
        const rows = await source.listMessages({
          accountId: input.accountId,
          conversationId: input.conversationId,
          cursor: input.cursor,
          limit,
        });
        const hasMore = rows.length > limit;
        const visibleRows = rows.slice(0, limit);
        const items = parseMessageRows(
          visibleRows,
          input.conversationId
        ).reverse();
        const last = visibleRows[visibleRows.length - 1] as
          Record<string, unknown> | undefined;
        return {
          items,
          nextCursor:
            hasMore && last
              ? { createdAt: last.created_at as string, id: last.id as string }
              : null,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === CONVERSATION_UNAVAILABLE
        )
          throw error;
        throw new Error(LOAD_ERROR);
      }
    },

    async get(accountId, conversationId, messageId) {
      try {
        if (!(await source.conversationExists(accountId, conversationId))) {
          throw new Error(CONVERSATION_UNAVAILABLE);
        }
        const row = await source.findMessage({
          accountId,
          conversationId,
          messageId,
        });
        if (row === null) throw new Error(MESSAGE_UNAVAILABLE);
        const [message] = parseMessageRows([row], conversationId);
        if (message.id !== messageId) throw new Error(MESSAGE_UNAVAILABLE);
        return message;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === CONVERSATION_UNAVAILABLE ||
            error.message === MESSAGE_UNAVAILABLE)
        ) {
          throw error;
        }
        throw new Error(MESSAGE_UNAVAILABLE);
      }
    },
  };
}

function requireSelectedBranch(accountId: string, error: string): void {
  if (selectedBranchRef.get() !== accountId) throw new Error(error);
}

export const mobileMessageQuerySource: MessageQuerySource = {
  async conversationExists(accountId, conversationId) {
    requireSelectedBranch(accountId, CONVERSATION_UNAVAILABLE);
    const { data, error } = await mobileSupabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', conversationId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .maybeSingle();
    if (error) throw new Error(CONVERSATION_UNAVAILABLE);
    return data !== null;
  },

  async listMessages(input) {
    requireSelectedBranch(input.accountId, CONVERSATION_UNAVAILABLE);
    let query = mobileSupabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', input.conversationId)
      .setHeader('x-usefuldesk-account-id', input.accountId);
    if (input.cursor) {
      query = query.or(
        `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`
      );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit + 1);
    if (error || !data) throw new Error(LOAD_ERROR);
    return data;
  },

  async findMessage(input) {
    requireSelectedBranch(input.accountId, CONVERSATION_UNAVAILABLE);
    const { data, error } = await mobileSupabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', input.conversationId)
      .eq('id', input.messageId)
      .setHeader('x-usefuldesk-account-id', input.accountId)
      .maybeSingle();
    if (error) throw new Error(MESSAGE_UNAVAILABLE);
    return data;
  },
};

export const mobileMessageRepository = createMessageRepository(
  mobileMessageQuerySource
);
