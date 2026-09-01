import {
  createMessageRepository,
  getLatestCustomerMessageAt,
  mobileMessageQuerySource,
  type MessageQuerySource,
} from './message-repository';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
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
      findLatestInboundMessage: jest.fn(),
    };
    await expect(
      createMessageRepository(source).list({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        cursor: null,
        limit: 40,
      })
    ).rejects.toEqual(new Error('Conversation is unavailable'));
    expect(source.listMessages).not.toHaveBeenCalled();
  });

  it('returns chronological items and a cursor for the next older page', async () => {
    const source: MessageQuerySource = {
      conversationExists: jest.fn().mockResolvedValue(true),
      listMessages: jest.fn().mockResolvedValue([
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
      findLatestInboundMessage: jest.fn(),
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
      findLatestInboundMessage: jest.fn(),
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

  it('gets the latest customer timestamp only after proving conversation ownership', async () => {
    const calls: string[] = [];
    const source = {
      conversationExists: jest.fn().mockImplementation(async () => {
        calls.push('conversation');
        return true;
      }),
      listMessages: jest.fn(),
      findMessage: jest.fn(),
      findLatestInboundMessage: jest.fn().mockImplementation(async (input) => {
        calls.push('latest');
        expect(input).toEqual({
          accountId: BRANCH_ID,
          conversationId: CONVERSATION_ID,
        });
        return { created_at: '2026-09-01T08:04:00.000Z' };
      }),
    } as unknown as MessageQuerySource;

    await expect(
      createMessageRepository(source).getLatestCustomerMessageAt(
        BRANCH_ID,
        CONVERSATION_ID
      )
    ).resolves.toBe('2026-09-01T08:04:00.000Z');
    expect(calls).toEqual(['conversation', 'latest']);
  });

  it('fails closed instead of reading the latest customer message for an unavailable conversation', async () => {
    const source = {
      conversationExists: jest.fn().mockResolvedValue(false),
      listMessages: jest.fn(),
      findMessage: jest.fn(),
      findLatestInboundMessage: jest.fn(),
    } as unknown as MessageQuerySource;

    await expect(
      createMessageRepository(source).getLatestCustomerMessageAt(
        BRANCH_ID,
        CONVERSATION_ID
      )
    ).rejects.toEqual(new Error('Conversation is unavailable'));
    expect(source.findLatestInboundMessage).not.toHaveBeenCalled();
  });

  it('rejects a list source call when the selected account does not match', async () => {
    const from = jest.spyOn(mobileSupabase, 'from');
    selectedBranchRef.set('ab92ad08-3808-4a3e-8d50-7a5fa2a6a770');
    await expect(
      mobileMessageQuerySource.listMessages({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        cursor: null,
        limit: 40,
      })
    ).rejects.toEqual(new Error('Conversation is unavailable'));
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    selectedBranchRef.set(null);
  });

  it('rejects realtime hydration source calls across selected accounts', async () => {
    const from = jest.spyOn(mobileSupabase, 'from');
    selectedBranchRef.set('ab92ad08-3808-4a3e-8d50-7a5fa2a6a770');
    await expect(
      mobileMessageQuerySource.findMessage({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_1_ID,
      })
    ).rejects.toEqual(new Error('Conversation is unavailable'));
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    selectedBranchRef.set(null);
  });

  it('fails closed before a latest-customer query across selected accounts', async () => {
    const from = jest.spyOn(mobileSupabase, 'from');
    selectedBranchRef.set('ab92ad08-3808-4a3e-8d50-7a5fa2a6a770');
    await expect(
      getLatestCustomerMessageAt(BRANCH_ID, CONVERSATION_ID)
    ).rejects.toEqual(new Error('Conversation is unavailable'));
    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    selectedBranchRef.set(null);
  });
});
