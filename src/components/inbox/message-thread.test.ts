import { describe, expect, it } from 'vitest';

import type { Message } from '@/types';
import { reconcileResyncedMessages } from './message-thread';

const message = (id: string, createdAt: string, status = 'sent'): Message =>
  ({
    id,
    conversation_id: 'conversation-1',
    sender_type: 'agent',
    content_type: 'text',
    content_text: id,
    status,
    created_at: createdAt,
  }) as Message;

describe('reconcileResyncedMessages', () => {
  it('keeps optimistic and realtime messages while replacing stale page rows', () => {
    const result = reconcileResyncedMessages(
      [
        message('older', '2026-09-08T10:00:00.000Z'),
        message('realtime', '2026-09-08T10:02:00.000Z'),
        message('temp-1', '2026-09-08T10:03:00.000Z', 'sending'),
      ],
      [
        message('older', '2026-09-08T10:00:00.000Z', 'read'),
        message('server-new', '2026-09-08T10:01:00.000Z'),
      ]
    );

    expect(result.map((item) => item.id)).toEqual([
      'older',
      'server-new',
      'realtime',
      'temp-1',
    ]);
    expect(result.find((item) => item.id === 'older')?.status).toBe('read');
    expect(result.find((item) => item.id === 'temp-1')?.status).toBe('sending');
  });
});
