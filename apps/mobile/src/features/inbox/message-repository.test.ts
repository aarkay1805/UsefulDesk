import {
  createMessageRepository,
  type MessageQuerySource,
} from './message-repository';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  MESSAGE_1_ID,
  MESSAGE_2_ID,
  MESSAGE_3_ID,
  rawMessage,
} from './inbox-test-fixtures';

describe('MessageRepository', () => {
  it('verifies the conversation in the selected branch before reading messages', async () => {
    const source: MessageQuerySource = {
      conversationExists: jest.fn().mockResolvedValue(false),
      listMessages: jest.fn(),
      findMessage: jest.fn(),
    };
    await expect(
      createMessageRepository(source).list({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        cursor: null,
        limit: 40,
      })
    ).rejects.toThrow('Conversation is unavailable');
    expect(source.listMessages).not.toHaveBeenCalled();
  });

  it('returns chronological items and a cursor for the next older page', async () => {
    const source: MessageQuerySource = {
      conversationExists: jest.fn().mockResolvedValue(true),
      listMessages: jest
        .fn()
        .mockResolvedValue([
          rawMessage({
            id: MESSAGE_3_ID,
            created_at: '2026-09-01T08:03:00.000Z',
          }),
          rawMessage({
            id: MESSAGE_2_ID,
            created_at: '2026-09-01T08:02:00.000Z',
          }),
          rawMessage({
            id: MESSAGE_1_ID,
            created_at: '2026-09-01T08:01:00.000Z',
          }),
        ]),
      findMessage: jest.fn(),
    };
    const page = await createMessageRepository(source).list({
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      cursor: null,
      limit: 2,
    });
    expect(page.items.map((item) => item.id)).toEqual([
      MESSAGE_2_ID,
      MESSAGE_3_ID,
    ]);
    expect(page.nextCursor).toEqual({
      createdAt: '2026-09-01T08:02:00.000Z',
      id: MESSAGE_2_ID,
    });
  });

  it('hydrates one realtime message only after selected-branch proof', async () => {
    const source: MessageQuerySource = {
      conversationExists: jest.fn().mockResolvedValue(true),
      listMessages: jest.fn(),
      findMessage: jest.fn().mockResolvedValue(rawMessage()),
    };
    await expect(
      createMessageRepository(source).get(
        BRANCH_ID,
        CONVERSATION_ID,
        MESSAGE_1_ID
      )
    ).resolves.toMatchObject({ id: MESSAGE_1_ID });
    expect(source.findMessage).toHaveBeenCalledWith({
      accountId: BRANCH_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_1_ID,
    });
  });
});
