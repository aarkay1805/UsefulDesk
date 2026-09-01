import {
  createConversationRepository,
  normalizeConversationSearch,
  type ConversationQuerySource,
} from './conversation-repository';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  EMPTY_CONVERSATION_ID,
  OTHER_BRANCH_ID,
  rawConversation,
} from './inbox-test-fixtures';

function source(): ConversationQuerySource {
  return {
    listMessaged: jest.fn().mockResolvedValue([]),
    listEmpty: jest.fn().mockResolvedValue([]),
    findContactIds: jest.fn().mockResolvedValue([]),
    countUnread: jest.fn().mockResolvedValue(0),
    findById: jest.fn().mockResolvedValue(null),
    clearUnread: jest.fn().mockResolvedValue([{ id: CONVERSATION_ID }]),
  };
}

describe('ConversationRepository', () => {
  it('never returns a row outside the selected branch', async () => {
    const querySource = source();
    querySource.listMessaged = jest
      .fn()
      .mockResolvedValue([rawConversation({ account_id: OTHER_BRANCH_ID })]);

    await expect(
      createConversationRepository(querySource).list({
        accountId: BRANCH_ID,
        filter: 'all',
        search: '',
        cursor: null,
        limit: 20,
      })
    ).rejects.toThrow('Could not load conversations');
  });

  it('moves from non-null last-message pagination into empty conversations', async () => {
    const querySource = source();
    querySource.listMessaged = jest
      .fn()
      .mockResolvedValue([
        rawConversation({ last_message_at: '2026-09-01T08:00:00.000Z' }),
      ]);
    querySource.listEmpty = jest.fn().mockResolvedValue([
      rawConversation({ id: EMPTY_CONVERSATION_ID, last_message_at: null }),
      rawConversation({
        id: '00cdd031-972a-4038-8178-029e6470f722',
        last_message_at: null,
        created_at: '2026-08-31T08:00:00.000Z',
      }),
    ]);

    const page = await createConversationRepository(querySource).list({
      accountId: BRANCH_ID,
      filter: 'all',
      search: '',
      cursor: null,
      limit: 2,
    });

    expect(page.items.map((item) => item.id)).toEqual([
      CONVERSATION_ID,
      EMPTY_CONVERSATION_ID,
    ]);
    expect(page.nextCursor).toEqual({
      phase: 'empty',
      createdAt: '2026-09-01T08:00:00.000Z',
      id: EMPTY_CONVERSATION_ID,
    });
  });

  it('sanitizes PostgREST grammar before searching the branch', async () => {
    const querySource = source();
    querySource.findContactIds = jest.fn().mockResolvedValue([]);

    await createConversationRepository(querySource).list({
      accountId: BRANCH_ID,
      filter: 'all',
      search: 'Asha,or(id.eq.secret)',
      cursor: null,
      limit: 20,
    });

    expect(querySource.findContactIds).toHaveBeenCalledWith(
      BRANCH_ID,
      'Asha or id eq secret'
    );
  });

  it('treats zero returned rows as a failed unread mutation', async () => {
    const querySource = source();
    querySource.clearUnread = jest.fn().mockResolvedValue([]);

    await expect(
      createConversationRepository(querySource).markRead(
        BRANCH_ID,
        CONVERSATION_ID
      )
    ).rejects.toThrow('Could not mark this conversation as read');
  });

  it('returns the exact selected-branch unread count', async () => {
    const querySource = source();
    querySource.countUnread = jest.fn().mockResolvedValue(7);
    const repository = createConversationRepository(querySource);

    await expect(repository.unreadCount(BRANCH_ID)).resolves.toBe(7);
    expect(querySource.countUnread).toHaveBeenCalledWith(BRANCH_ID);
  });

  it('rejects realtime hydration when the row is not in the selected branch', async () => {
    const querySource = source();
    querySource.findById = jest
      .fn()
      .mockResolvedValue(rawConversation({ account_id: OTHER_BRANCH_ID }));

    await expect(
      createConversationRepository(querySource).get(BRANCH_ID, CONVERSATION_ID)
    ).rejects.toThrow('Conversation is unavailable');
  });

  it('uses the final visible item for a messaged lookahead cursor', async () => {
    const querySource = source();
    querySource.listMessaged = jest.fn().mockResolvedValue([
      rawConversation(),
      rawConversation({
        id: '00cdd031-972a-4038-8178-029e6470f722',
        last_message_at: '2026-08-31T08:00:00.000Z',
      }),
    ]);

    await expect(
      createConversationRepository(querySource).list({
        accountId: BRANCH_ID,
        filter: 'all',
        search: '',
        cursor: null,
        limit: 1,
      })
    ).resolves.toMatchObject({
      nextCursor: {
        phase: 'messaged',
        lastMessageAt: '2026-09-01T08:00:00.000Z',
        id: CONVERSATION_ID,
      },
    });
  });

  it('keeps a messaged cursor when a full page has empty-phase rows after it', async () => {
    const querySource = source();
    querySource.listMessaged = jest.fn().mockResolvedValue([rawConversation()]);
    querySource.listEmpty = jest
      .fn()
      .mockResolvedValue([rawConversation({ last_message_at: null })]);

    await expect(
      createConversationRepository(querySource).list({
        accountId: BRANCH_ID,
        filter: 'all',
        search: '',
        cursor: null,
        limit: 1,
      })
    ).resolves.toMatchObject({
      items: [{ id: CONVERSATION_ID }],
      nextCursor: {
        phase: 'messaged',
        lastMessageAt: '2026-09-01T08:00:00.000Z',
        id: CONVERSATION_ID,
      },
    });
    expect(querySource.listEmpty).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 })
    );
  });

  it('rejects an invalid cursor before it reaches a query source', async () => {
    const querySource = source();

    await expect(
      createConversationRepository(querySource).list({
        accountId: BRANCH_ID,
        filter: 'all',
        search: '',
        cursor: {
          phase: 'messaged',
          lastMessageAt: 'or(id.eq.secret)',
          id: CONVERSATION_ID,
        },
        limit: 20,
      })
    ).rejects.toThrow('Could not load conversations');
    expect(querySource.listMessaged).not.toHaveBeenCalled();
  });
});

describe('normalizeConversationSearch', () => {
  it('removes PostgREST grammar and caps length', () => {
    expect(
      normalizeConversationSearch(`  Asha,or(id.eq.secret) ${'a'.repeat(120)} `)
    ).toHaveLength(100);
    expect(normalizeConversationSearch(' Asha,or(id.eq.secret) ')).toBe(
      'Asha or id eq secret'
    );
  });
});
