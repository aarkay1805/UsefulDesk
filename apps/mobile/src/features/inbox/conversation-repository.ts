import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import {
  isStrictIsoTimestamp,
  parseConversationRows,
} from './inbox-normalizers';
import type {
  ConversationCursor,
  ConversationFilter,
  InboxConversation,
  Page,
} from './inbox-types';

export const CONVERSATION_PAGE_SIZE = 30;

const LOAD_ERROR = 'Could not load conversations';
const UNAVAILABLE_ERROR = 'Conversation is unavailable';
const MARK_READ_ERROR = 'Could not mark this conversation as read';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONVERSATION_SELECT = `
  id,
  account_id,
  contact_id,
  status,
  assigned_agent_id,
  last_message_text,
  last_message_at,
  unread_count,
  created_at,
  updated_at,
  contact:contacts!inner(
    id,
    name,
    phone,
    avatar_url,
    memberships(id)
  )
`;

export interface ListConversationsInput {
  accountId: string;
  filter: ConversationFilter;
  search: string;
  cursor: ConversationCursor | null;
  limit?: number;
}

export interface ConversationRepository {
  list(
    input: ListConversationsInput
  ): Promise<Page<InboxConversation, ConversationCursor>>;
  unreadCount(accountId: string): Promise<number>;
  get(accountId: string, conversationId: string): Promise<InboxConversation>;
  markRead(accountId: string, conversationId: string): Promise<void>;
}

export interface ConversationPhaseQuery {
  accountId: string;
  filter: ConversationFilter;
  contactIds: string[];
  previewTerm: string | null;
  cursor: ConversationCursor | null;
  limit: number;
}

export interface ConversationQuerySource {
  listMessaged(input: ConversationPhaseQuery): Promise<unknown[]>;
  listEmpty(input: ConversationPhaseQuery): Promise<unknown[]>;
  findContactIds(accountId: string, term: string): Promise<string[]>;
  countUnread(accountId: string): Promise<number>;
  findById(accountId: string, conversationId: string): Promise<unknown | null>;
  clearUnread(accountId: string, conversationId: string): Promise<unknown[]>;
}

export function normalizeConversationSearch(value: string): string {
  return value
    .trim()
    .replace(/[,%.()"\\*_:|&]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    .trim();
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isCursor(value: ConversationCursor | null): boolean {
  if (value === null) return true;
  return value.phase === 'messaged'
    ? isStrictIsoTimestamp(value.lastMessageAt) && isUuid(value.id)
    : value.phase === 'empty' &&
        isStrictIsoTimestamp(value.createdAt) &&
        isUuid(value.id);
}

function cursorFor(
  item: InboxConversation,
  phase: ConversationCursor['phase']
): ConversationCursor {
  if (phase === 'messaged') {
    if (!item.lastMessageAt) throw new Error(LOAD_ERROR);
    return { phase, lastMessageAt: item.lastMessageAt, id: item.id };
  }
  return { phase, createdAt: item.createdAt, id: item.id };
}

function parsePhase(
  rows: unknown[],
  accountId: string,
  phase: ConversationCursor['phase']
): InboxConversation[] {
  const parsed = parseConversationRows(rows, accountId);
  if (
    parsed.some((item) =>
      phase === 'messaged'
        ? item.lastMessageAt === null
        : item.lastMessageAt !== null
    )
  ) {
    throw new Error(LOAD_ERROR);
  }
  return parsed;
}

function phaseInput(
  input: ListConversationsInput,
  contactIds: string[],
  previewTerm: string | null,
  cursor: ConversationCursor | null,
  limit: number
): ConversationPhaseQuery {
  return {
    accountId: input.accountId,
    filter: input.filter,
    contactIds,
    previewTerm,
    cursor,
    limit,
  };
}

export function createConversationRepository(
  source: ConversationQuerySource
): ConversationRepository {
  return {
    async list(input) {
      const limit = input.limit ?? CONVERSATION_PAGE_SIZE;
      if (!Number.isInteger(limit) || limit < 1 || !isCursor(input.cursor)) {
        throw new Error(LOAD_ERROR);
      }

      try {
        const search = normalizeConversationSearch(input.search);
        const contactIds = search
          ? (await source.findContactIds(input.accountId, search)).filter(
              isUuid
            )
          : [];
        const previewTerm = search || null;
        const emptyCursor =
          input.cursor?.phase === 'empty' ? input.cursor : null;

        if (emptyCursor) {
          const rows = parsePhase(
            await source.listEmpty(
              phaseInput(input, contactIds, previewTerm, emptyCursor, limit + 1)
            ),
            input.accountId,
            'empty'
          );
          const items = rows.slice(0, limit);
          return {
            items,
            nextCursor:
              rows.length > limit && items.length > 0
                ? cursorFor(items[items.length - 1], 'empty')
                : null,
          };
        }

        const messagedCursor =
          input.cursor?.phase === 'messaged' ? input.cursor : null;
        const messaged = parsePhase(
          await source.listMessaged(
            phaseInput(
              input,
              contactIds,
              previewTerm,
              messagedCursor,
              limit + 1
            )
          ),
          input.accountId,
          'messaged'
        );
        if (messaged.length > limit) {
          const items = messaged.slice(0, limit);
          return {
            items,
            nextCursor: cursorFor(items[items.length - 1], 'messaged'),
          };
        }

        const remaining = limit - messaged.length;
        if (remaining === 0) {
          const emptyLookahead = parsePhase(
            await source.listEmpty(
              phaseInput(input, contactIds, previewTerm, null, 1)
            ),
            input.accountId,
            'empty'
          );
          return {
            items: messaged,
            nextCursor:
              emptyLookahead.length > 0
                ? cursorFor(messaged[messaged.length - 1], 'messaged')
                : null,
          };
        }

        const empty = parsePhase(
          await source.listEmpty(
            phaseInput(input, contactIds, previewTerm, null, remaining + 1)
          ),
          input.accountId,
          'empty'
        );
        const visibleEmpty = empty.slice(0, remaining);
        const items = [...messaged, ...visibleEmpty];
        return {
          items,
          nextCursor:
            empty.length > remaining && visibleEmpty.length > 0
              ? cursorFor(visibleEmpty[visibleEmpty.length - 1], 'empty')
              : null,
        };
      } catch {
        throw new Error(LOAD_ERROR);
      }
    },

    async unreadCount(accountId) {
      try {
        const count = await source.countUnread(accountId);
        if (!Number.isInteger(count) || count < 0) throw new Error(LOAD_ERROR);
        return count;
      } catch {
        throw new Error(LOAD_ERROR);
      }
    },

    async get(accountId, conversationId) {
      try {
        const row = await source.findById(accountId, conversationId);
        if (row === null) throw new Error(UNAVAILABLE_ERROR);
        return parseConversationRows([row], accountId)[0];
      } catch {
        throw new Error(UNAVAILABLE_ERROR);
      }
    },

    async markRead(accountId, conversationId) {
      try {
        const rows = await source.clearUnread(accountId, conversationId);
        if (
          rows.length !== 1 ||
          typeof rows[0] !== 'object' ||
          rows[0] === null ||
          (rows[0] as { id?: unknown }).id !== conversationId
        ) {
          throw new Error(MARK_READ_ERROR);
        }
      } catch {
        throw new Error(MARK_READ_ERROR);
      }
    },
  };
}

function requireSelectedBranch(accountId: string, message: string): void {
  if (selectedBranchRef.get() !== accountId) throw new Error(message);
}

function escapedIlike(term: string): string {
  return `*${term}*`;
}

export const mobileConversationQuerySource: ConversationQuerySource = {
  async findContactIds(accountId, term) {
    requireSelectedBranch(accountId, LOAD_ERROR);
    const normalizedTerm = normalizeConversationSearch(term);
    if (!normalizedTerm) return [];
    const like = escapedIlike(normalizedTerm);
    const { data, error } = await mobileSupabase
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .or(`name.ilike.${like},phone.ilike.${like}`)
      .setHeader('x-usefuldesk-account-id', accountId);
    if (error || !data) throw new Error(LOAD_ERROR);
    return data.map((row) => row.id).filter(isUuid);
  },

  async listMessaged(input) {
    requireSelectedBranch(input.accountId, LOAD_ERROR);
    if (!isCursor(input.cursor)) throw new Error(LOAD_ERROR);
    const previewTerm = input.previewTerm
      ? normalizeConversationSearch(input.previewTerm)
      : null;
    const contactIds = input.contactIds.filter(isUuid);
    let query = mobileSupabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('account_id', input.accountId)
      .not('last_message_at', 'is', null)
      .setHeader('x-usefuldesk-account-id', input.accountId);
    if (input.filter === 'unread') query = query.gt('unread_count', 0);
    if (previewTerm) {
      const filters = [`last_message_text.ilike.${escapedIlike(previewTerm)}`];
      if (contactIds.length > 0)
        filters.push(`contact_id.in.(${contactIds.join(',')})`);
      query = query.or(filters.join(','));
    }
    if (input.cursor?.phase === 'messaged') {
      query = query.or(
        `last_message_at.lt.${input.cursor.lastMessageAt},and(last_message_at.eq.${input.cursor.lastMessageAt},id.lt.${input.cursor.id})`
      );
    }
    const { data, error } = await query
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit);
    if (error || !data) throw new Error(LOAD_ERROR);
    return data;
  },

  async listEmpty(input) {
    requireSelectedBranch(input.accountId, LOAD_ERROR);
    if (!isCursor(input.cursor)) throw new Error(LOAD_ERROR);
    const previewTerm = input.previewTerm
      ? normalizeConversationSearch(input.previewTerm)
      : null;
    const contactIds = input.contactIds.filter(isUuid);
    let query = mobileSupabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('account_id', input.accountId)
      .is('last_message_at', null)
      .setHeader('x-usefuldesk-account-id', input.accountId);
    if (input.filter === 'unread') query = query.gt('unread_count', 0);
    if (previewTerm) {
      const filters = [`last_message_text.ilike.${escapedIlike(previewTerm)}`];
      if (contactIds.length > 0)
        filters.push(`contact_id.in.(${contactIds.join(',')})`);
      query = query.or(filters.join(','));
    }
    if (input.cursor?.phase === 'empty') {
      query = query.or(
        `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`
      );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(input.limit);
    if (error || !data) throw new Error(LOAD_ERROR);
    return data;
  },

  async countUnread(accountId) {
    requireSelectedBranch(accountId, LOAD_ERROR);
    const { count, error } = await mobileSupabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gt('unread_count', 0)
      .setHeader('x-usefuldesk-account-id', accountId);
    if (error || count === null) throw new Error(LOAD_ERROR);
    return count;
  },

  async findById(accountId, conversationId) {
    requireSelectedBranch(accountId, UNAVAILABLE_ERROR);
    const { data, error } = await mobileSupabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('account_id', accountId)
      .eq('id', conversationId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .maybeSingle();
    if (error) throw new Error(UNAVAILABLE_ERROR);
    return data;
  },

  async clearUnread(accountId, conversationId) {
    requireSelectedBranch(accountId, MARK_READ_ERROR);
    const { data, error } = await mobileSupabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('account_id', accountId)
      .eq('id', conversationId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .select('id');
    if (error || !data) throw new Error(MARK_READ_ERROR);
    return data;
  },
};

export const mobileConversationRepository = createConversationRepository(
  mobileConversationQuerySource
);
