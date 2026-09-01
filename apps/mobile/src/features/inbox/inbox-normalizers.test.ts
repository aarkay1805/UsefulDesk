import { parseConversationRows, parseMessageRows } from './inbox-normalizers';
import {
  CONVERSATION_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
  BRANCH_ID,
  rawConversation,
  rawMessage,
} from './inbox-test-fixtures';

test('rejects a conversation from another branch', () => {
  expect(() =>
    parseConversationRows(
      [rawConversation({ account_id: OTHER_BRANCH_ID })],
      BRANCH_ID
    )
  ).toThrow('Invalid conversation row');
});

test('normalizes membership presence and nullable previews', () => {
  const rows = parseConversationRows(
    [
      rawConversation({
        last_message_text: null,
        last_message_at: null,
        unread_count: 0,
      }),
    ],
    BRANCH_ID
  );
  expect(rows[0]).toMatchObject({ isMember: true, lastMessageText: null });
});

test('rejects a message belonging to another conversation', () => {
  expect(() =>
    parseMessageRows(
      [rawMessage({ conversation_id: OTHER_CONVERSATION_ID })],
      CONVERSATION_ID
    )
  ).toThrow('Invalid message row');
});
