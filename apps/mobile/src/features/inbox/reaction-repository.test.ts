import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import {
  createReactionRepository,
  mobileReactionQuerySource,
  type ReactionQuerySource,
} from './reaction-repository';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_1_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
} from './inbox-test-fixtures';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const REACTION_ID = 'f34de80d-cdf4-4699-ac10-b0a1f0404cab';

function rawReaction(overrides: Record<string, unknown> = {}) {
  return {
    id: REACTION_ID,
    message_id: MESSAGE_1_ID,
    conversation_id: CONVERSATION_ID,
    actor_type: 'agent',
    actor_id: ACTOR_ID,
    emoji: '👍',
    created_at: '2026-09-03T06:00:00.000Z',
    ...overrides,
  };
}

describe('ReactionRepository', () => {
  it('normalizes only reactions from the requested conversation', async () => {
    const source: ReactionQuerySource = {
      listReactions: jest.fn().mockResolvedValue([
        rawReaction(),
        rawReaction({
          id: '5d7459ed-c7d6-468e-8238-20cc818ba63e',
          actor_type: 'customer',
          actor_id: 'ba8df73d-a33e-4236-a93b-357149bc6ea0',
          emoji: '❤️',
        }),
      ]),
    };

    await expect(
      createReactionRepository(source).list(BRANCH_ID, CONVERSATION_ID)
    ).resolves.toEqual([
      {
        id: REACTION_ID,
        messageId: MESSAGE_1_ID,
        conversationId: CONVERSATION_ID,
        actorType: 'agent',
        actorId: ACTOR_ID,
        emoji: '👍',
        createdAt: '2026-09-03T06:00:00.000Z',
      },
      {
        id: '5d7459ed-c7d6-468e-8238-20cc818ba63e',
        messageId: MESSAGE_1_ID,
        conversationId: CONVERSATION_ID,
        actorType: 'customer',
        actorId: 'ba8df73d-a33e-4236-a93b-357149bc6ea0',
        emoji: '❤️',
        createdAt: '2026-09-03T06:00:00.000Z',
      },
    ]);
  });

  it.each([
    ['wrong conversation', { conversation_id: OTHER_CONVERSATION_ID }],
    ['missing actor', { actor_id: null }],
    ['unknown actor type', { actor_type: 'bot' }],
    ['empty emoji', { emoji: '' }],
  ])(
    'rejects %s rows as an unavailable reaction list',
    async (_name, override) => {
      const source: ReactionQuerySource = {
        listReactions: jest.fn().mockResolvedValue([rawReaction(override)]),
      };

      await expect(
        createReactionRepository(source).list(BRANCH_ID, CONVERSATION_ID)
      ).rejects.toEqual(new Error('Could not load reactions'));
    }
  );

  it('fails closed before querying a branch that is no longer selected', async () => {
    const from = jest.spyOn(mobileSupabase, 'from');
    selectedBranchRef.set(OTHER_BRANCH_ID);
    try {
      await expect(
        mobileReactionQuerySource.listReactions(BRANCH_ID, CONVERSATION_ID)
      ).rejects.toEqual(new Error('Could not load reactions'));
      expect(from).not.toHaveBeenCalled();
    } finally {
      from.mockRestore();
      selectedBranchRef.set(null);
    }
  });

  it('queries the denormalized conversation key with the selected branch header', async () => {
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      setHeader: jest.fn(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.setHeader.mockReturnValue(query);
    const from = jest
      .spyOn(mobileSupabase, 'from')
      .mockReturnValue(query as never);
    selectedBranchRef.set(BRANCH_ID);
    try {
      await mobileReactionQuerySource.listReactions(BRANCH_ID, CONVERSATION_ID);
      expect(from).toHaveBeenCalledWith('message_reactions');
      expect(query.eq).toHaveBeenCalledWith('conversation_id', CONVERSATION_ID);
      expect(query.setHeader).toHaveBeenCalledWith(
        'x-usefuldesk-account-id',
        BRANCH_ID
      );
    } finally {
      from.mockRestore();
      selectedBranchRef.set(null);
    }
  });
});
