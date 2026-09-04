import { buildFormatters } from '../../../../../src/lib/locale/format';
import { DEFAULT_ACCOUNT_LOCALE } from '../../../../../src/lib/locale/config';

import {
  buildThreadItems,
  calendarProximity,
  conversationTimestamp,
  messagePreview,
  safeMediaUrl,
  startsNewRun,
  threadDateLabel,
} from './inbox-format';
import { MESSAGE_1_ID, MESSAGE_2_ID, message } from './inbox-test-fixtures';

// The gym's own zone, which is the whole point: every label below is read
// in Asia/Kolkata (UTC+5:30), never in the device's zone.
const IST = buildFormatters(DEFAULT_ACCOUNT_LOCALE);
const NOW = new Date('2026-09-04T06:30:00.000Z'); // 4 Sept, 12:00 IST

test('reads calendar proximity in the account zone, not the device zone', () => {
  const zone = DEFAULT_ACCOUNT_LOCALE.timeZone;
  // 20:10 UTC on 3 Sept is already 01:40 IST on 4 Sept — "today" for the
  // gym even though UTC still calls it yesterday.
  expect(calendarProximity('2026-09-03T20:10:00.000Z', zone, NOW)).toBe(
    'today'
  );
  // 19:30 UTC on 2 Sept is 01:00 IST on the 3rd — yesterday for the gym,
  // while UTC still files it two days back.
  expect(calendarProximity('2026-09-02T19:30:00.000Z', zone, NOW)).toBe(
    'yesterday'
  );
  // Six days back is the last day a weekday name can still be unambiguous.
  expect(calendarProximity('2026-08-29T06:00:00.000Z', zone, NOW)).toBe('week');
  expect(calendarProximity('2026-08-28T06:00:00.000Z', zone, NOW)).toBe(
    'older'
  );
  expect(calendarProximity('not-a-date', zone, NOW)).toBe('older');
});

test('walks a conversation row from a clock time up to a date', () => {
  // The defect this replaces: every row printed a bare clock time, so a
  // three-week-old chat was indistinguishable from a ten-minute-old one.
  expect(conversationTimestamp('2026-09-04T04:15:00.000Z', IST, NOW)).toBe(
    IST.time('2026-09-04T04:15:00.000Z')
  );
  expect(conversationTimestamp('2026-09-03T04:15:00.000Z', IST, NOW)).toBe(
    'Yesterday'
  );
  expect(conversationTimestamp('2026-09-01T04:15:00.000Z', IST, NOW)).toBe(
    'Tuesday'
  );
  expect(conversationTimestamp('2026-07-11T04:15:00.000Z', IST, NOW)).toBe(
    '11/07/2026'
  );
});

test('names the two recent days outright in a thread separator', () => {
  expect(threadDateLabel('2026-09-04T04:15:00.000Z', IST, NOW)).toBe('Today');
  expect(threadDateLabel('2026-09-03T04:15:00.000Z', IST, NOW)).toBe(
    'Yesterday'
  );
  expect(threadDateLabel('2026-09-01T04:15:00.000Z', IST, NOW)).toBe('Tuesday');
  expect(threadDateLabel('2026-07-11T04:15:00.000Z', IST, NOW)).toBe(
    '11 Jul 2026'
  );
});

test('keeps every separator label distinct across a full week of history', () => {
  // buildThreadItems groups on the label, so two different days sharing one
  // label would silently merge into a single run. Six days is the ceiling
  // that keeps weekday names unambiguous.
  const labels = Array.from({ length: 9 }, (_, index) =>
    threadDateLabel(
      new Date(NOW.getTime() - index * 86_400_000).toISOString(),
      IST,
      NOW
    )
  );
  expect(new Set(labels).size).toBe(labels.length);
});

test('groups sender runs only inside the ten-minute window', () => {
  const previous = {
    senderType: 'customer',
    createdAt: '2026-09-01T08:00:00.000Z',
  } as const;
  expect(
    startsNewRun(previous, {
      senderType: 'customer',
      createdAt: '2026-09-01T08:09:59.000Z',
    })
  ).toBe(false);
  expect(
    startsNewRun(previous, {
      senderType: 'agent',
      createdAt: '2026-09-01T08:01:00.000Z',
    })
  ).toBe(true);
});

test('starts a sender run at exactly ten minutes', () => {
  const previous = message({ createdAt: '2026-09-01T08:00:00.000Z' });
  const current = message({ createdAt: '2026-09-01T08:10:00.000Z' });
  expect(startsNewRun(previous, current)).toBe(true);
});

test('allows only HTTPS media and names unsupported content honestly', () => {
  expect(safeMediaUrl('https://cdn.example.com/a.jpg')).toBe(
    'https://cdn.example.com/a.jpg'
  );
  expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
  expect(messagePreview({ contentType: 'document', contentText: null })).toBe(
    'Document'
  );
});

test('inserts localized date separators and restarts sender runs by day', () => {
  const items = buildThreadItems(
    [
      message({ id: MESSAGE_1_ID, createdAt: '2026-09-01T23:59:00.000Z' }),
      message({ id: MESSAGE_2_ID, createdAt: '2026-09-02T00:01:00.000Z' }),
    ],
    (value) => (value.startsWith('2026-09-01') ? '1 Sept 2026' : '2 Sept 2026')
  );
  expect(items.map((item) => item.kind)).toEqual([
    'date',
    'message',
    'date',
    'message',
  ]);
  expect(items[3]).toMatchObject({ kind: 'message', startsRun: true });
});
