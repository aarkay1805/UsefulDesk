import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import { isStrictIsoTimestamp } from './inbox-normalizers';
import type { InboxMessageReaction, ReactionActor } from './inbox-types';

const LOAD_ERROR = 'Could not load reactions';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTORS = new Set<ReactionActor>(['customer', 'agent']);

export interface ReactionQuerySource {
  listReactions(accountId: string, conversationId: string): Promise<unknown[]>;
}

export interface ReactionRepository {
  list(
    accountId: string,
    conversationId: string
  ): Promise<InboxMessageReaction[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function parseRows(
  rows: unknown[],
  conversationId: string
): InboxMessageReaction[] {
  if (!isUuid(conversationId)) throw new Error(LOAD_ERROR);
  return rows.map((row) => {
    if (!isRecord(row)) throw new Error(LOAD_ERROR);
    if (
      !isUuid(row.id) ||
      !isUuid(row.message_id) ||
      row.conversation_id !== conversationId ||
      !isUuid(row.conversation_id) ||
      !ACTORS.has(row.actor_type as ReactionActor) ||
      !isUuid(row.actor_id) ||
      typeof row.emoji !== 'string' ||
      row.emoji.length === 0 ||
      !isStrictIsoTimestamp(row.created_at)
    ) {
      throw new Error(LOAD_ERROR);
    }
    return {
      id: row.id,
      messageId: row.message_id,
      conversationId: row.conversation_id,
      actorType: row.actor_type as ReactionActor,
      actorId: row.actor_id,
      emoji: row.emoji,
      createdAt: row.created_at,
    };
  });
}

export function createReactionRepository(
  source: ReactionQuerySource
): ReactionRepository {
  return {
    async list(accountId, conversationId) {
      try {
        return parseRows(
          await source.listReactions(accountId, conversationId),
          conversationId
        );
      } catch {
        throw new Error(LOAD_ERROR);
      }
    },
  };
}

export const mobileReactionQuerySource: ReactionQuerySource = {
  async listReactions(accountId, conversationId) {
    if (selectedBranchRef.get() !== accountId) throw new Error(LOAD_ERROR);
    const { data, error } = await mobileSupabase
      .from('message_reactions')
      .select(
        'id, message_id, conversation_id, actor_type, actor_id, emoji, created_at'
      )
      .eq('conversation_id', conversationId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .order('created_at', { ascending: true });
    if (error || !data) throw new Error(LOAD_ERROR);
    return data;
  },
};

export const mobileReactionRepository = createReactionRepository(
  mobileReactionQuerySource
);
