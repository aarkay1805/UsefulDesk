import {
  isStrictIsoTimestamp,
  parseConversationRows,
  parseMessageRows,
} from './inbox-normalizers';
import {
  CONVERSATION_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
  BRANCH_ID,
  rawConversation,
  rawMessage,
} from './inbox-test-fixtures';

describe('isStrictIsoTimestamp', () => {
  test.each([
    '2026-09-01T08:00:00Z',
    '2026-09-01T08:00:00.123456Z',
    '2026-09-01T08:00:00+00:00',
    '2026-09-01T08:00:00+05:30',
    '2026-09-01T08:00:00-04:30',
  ])('accepts valid timestamp %s', (value) => {
    expect(isStrictIsoTimestamp(value)).toBe(true);
  });

  test.each([
    '2026-09-01T08:00:00+24:00',
    '2026-09-01T08:00:00+00:60',
    '2026-09-01T08:00:00',
    '2026-02-30T08:00:00Z',
    '2026-04-31T08:00:00Z',
    '2026-00-01T08:00:00Z',
    '2026-09-00T08:00:00Z',
    '2026-09-01T24:00:00Z',
    '2026-09-01T08:60:00Z',
    '2026-09-01T08:00:60Z',
  ])('rejects invalid timestamp %s', (value) => {
    expect(isStrictIsoTimestamp(value)).toBe(false);
  });

  test('rejects a regex-matching timestamp that Date.parse cannot parse', () => {
    const value = '2026-13-01T08:00:00Z';

    expect(Date.parse(value)).toBeNaN();
    expect(isStrictIsoTimestamp(value)).toBe(false);
  });
});

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

test('accepts a complete PostgREST conversation row with offset timestamps', () => {
  const timestamp = '2026-09-01T08:00:00.123456+00:00';

  expect(
    parseConversationRows(
      [
        rawConversation({
          last_message_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        }),
      ],
      BRANCH_ID
    )
  ).toMatchObject([
    {
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
});

test('accepts a complete PostgREST message row with an offset timestamp', () => {
  const timestamp = '2026-09-01T08:01:00.123456+00:00';

  expect(
    parseMessageRows([rawMessage({ created_at: timestamp })], CONVERSATION_ID)
  ).toMatchObject([{ createdAt: timestamp }]);
});

test('rejects malformed and timezone-less timestamps', () => {
  expect(() =>
    parseConversationRows(
      [rawConversation({ created_at: '2026-09-01 08:00:00+00:00' })],
      BRANCH_ID
    )
  ).toThrow('Invalid conversation row');
  expect(() =>
    parseMessageRows(
      [rawMessage({ created_at: '2026-09-01T08:01:00.123456' })],
      CONVERSATION_ID
    )
  ).toThrow('Invalid message row');
});

test('rejects a message belonging to another conversation', () => {
  expect(() =>
    parseMessageRows(
      [rawMessage({ conversation_id: OTHER_CONVERSATION_ID })],
      CONVERSATION_ID
    )
  ).toThrow('Invalid message row');
});
