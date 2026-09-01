import { parseConversationRows, parseMessageRows } from './inbox-normalizers';
import {
  CONVERSATION_ID,
  CONTACT_ID,
  MESSAGE_1_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
  BRANCH_ID,
} from './inbox-test-fixtures';

test('rejects a conversation from another branch', () => {
  expect(() =>
    parseConversationRows(
      [
        {
          id: CONVERSATION_ID,
          account_id: OTHER_BRANCH_ID,
          contact_id: CONTACT_ID,
        },
      ],
      BRANCH_ID
    )
  ).toThrow('Invalid conversation row');
});

test('normalizes membership presence and nullable previews', () => {
  const rows = parseConversationRows(
    [
      {
        id: CONVERSATION_ID,
        account_id: BRANCH_ID,
        contact_id: CONTACT_ID,
        status: 'open',
        assigned_agent_id: null,
        last_message_text: null,
        last_message_at: null,
        unread_count: 0,
        created_at: '2026-09-01T08:00:00.000Z',
        updated_at: '2026-09-01T08:00:00.000Z',
        contact: {
          id: CONTACT_ID,
          name: 'Asha Rao',
          phone: '9876543210',
          avatar_url: null,
          memberships: [{ id: 'membership-1' }],
        },
      },
    ],
    BRANCH_ID
  );
  expect(rows[0]).toMatchObject({ isMember: true, lastMessageText: null });
});

test('rejects a message belonging to another conversation', () => {
  expect(() =>
    parseMessageRows(
      [{ id: MESSAGE_1_ID, conversation_id: OTHER_CONVERSATION_ID }],
      CONVERSATION_ID
    )
  ).toThrow('Invalid message row');
});
