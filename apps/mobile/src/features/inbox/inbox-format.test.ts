import {
  buildThreadItems,
  messagePreview,
  safeMediaUrl,
  startsNewRun,
} from './inbox-format';
import { MESSAGE_1_ID, MESSAGE_2_ID, message } from './inbox-test-fixtures';

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
