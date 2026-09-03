import { describe, expect, it, vi } from 'vitest';

import { drainPushDeliveries } from './dispatcher';
import type { ExpoPushOutcome, ExpoPushTransport } from './expo-protocol';

const WORKER_ID = '11111111-1111-4111-8111-111111111111';

function adminFor(input: {
  receipts?: unknown[];
  deliveries?: unknown[];
  receiptCancelled?: number;
  deliveryCancelled?: number;
}) {
  const settlements: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_push_receipts') {
      return {
        data: [
          ...(input.receipts ?? []),
          ...((input.receipts?.length ?? 0) === 0 && input.receiptCancelled
            ? [{ delivery_id: null, cancelled_count: input.receiptCancelled }]
            : []),
        ],
        error: null,
      };
    }
    if (name === 'claim_push_deliveries') {
      return {
        data: [
          ...(input.deliveries ?? []),
          ...((input.deliveries?.length ?? 0) === 0 && input.deliveryCancelled
            ? [{ delivery_id: null, cancelled_count: input.deliveryCancelled }]
            : []),
        ],
        error: null,
      };
    }
    if (name === 'settle_push_delivery') {
      settlements.push(args);
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  return { admin: { rpc } as never, rpc, settlements };
}

describe('push dispatcher', () => {
  it('settles receipts before sends and aggregates independent outcomes', async () => {
    const db = adminFor({
      receipts: [
        {
          delivery_id: 'receipt-delivery',
          expo_ticket_id: 'ticket-1',
          attempt_count: 1,
          cancelled_count: 2,
        },
      ],
      deliveries: [
        {
          delivery_id: 'send-ok',
          expo_push_token: 'ExponentPushToken[ok]',
          title: 'Ada',
          body: 'Hello',
          payload: { version: 1 },
          attempt_count: 1,
          cancelled_count: 3,
        },
        {
          delivery_id: 'send-dead',
          expo_push_token: 'ExponentPushToken[dead]',
          title: 'Grace',
          body: 'Hi',
          payload: { version: 1 },
          attempt_count: 2,
          cancelled_count: 3,
        },
      ],
    });
    const calls: string[] = [];
    const transport: ExpoPushTransport = {
      receipts: vi.fn(async (): Promise<ExpoPushOutcome[]> => {
        calls.push('receipts');
        return [{ deliveryId: 'receipt-delivery', kind: 'delivered' }];
      }),
      send: vi.fn(async (): Promise<ExpoPushOutcome[]> => {
        calls.push('send');
        return [
          { deliveryId: 'send-ok', kind: 'ticketed', ticketId: 'ticket-2' },
          {
            deliveryId: 'send-dead',
            kind: 'permanent_token',
            code: 'DeviceNotRegistered',
          },
        ];
      }),
    };

    await expect(
      drainPushDeliveries({
        admin: db.admin,
        transport,
        workerId: WORKER_ID,
        now: () => new Date('2026-09-03T12:00:00.000Z'),
      })
    ).resolves.toEqual({
      claimed: 3,
      ticketed: 1,
      delivered: 1,
      retried: 0,
      failed: 1,
      cancelled: 5,
      installationsRetired: 1,
    });
    expect(calls).toEqual(['receipts', 'send']);
    expect(db.settlements).toContainEqual(
      expect.objectContaining({
        p_delivery_id: 'send-dead',
        p_worker_id: WORKER_ID,
        p_outcome: 'failed',
        p_retire_installation: true,
      })
    );
  });

  it('keeps delayed receipts ticketed and retries transient sends with backoff', async () => {
    const db = adminFor({
      receipts: [
        {
          delivery_id: 'receipt-wait',
          expo_ticket_id: 'ticket-wait',
          attempt_count: 1,
          cancelled_count: 0,
        },
      ],
      deliveries: [
        {
          delivery_id: 'send-retry',
          expo_push_token: 'ExponentPushToken[retry]',
          title: 'Ada',
          body: 'Hello',
          payload: { version: 1 },
          attempt_count: 2,
          cancelled_count: 0,
        },
      ],
    });
    const transport: ExpoPushTransport = {
      receipts: vi.fn(async (): Promise<ExpoPushOutcome[]> => [
        {
          deliveryId: 'receipt-wait',
          kind: 'receipt_pending',
          code: 'receipt_not_ready',
        },
      ]),
      send: vi.fn(async (): Promise<ExpoPushOutcome[]> => [
        { deliveryId: 'send-retry', kind: 'retry', code: 'expo_http_503' },
      ]),
    };

    const result = await drainPushDeliveries({
      admin: db.admin,
      transport,
      workerId: WORKER_ID,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
      random: () => 0,
    });

    expect(result.retried).toBe(2);
    expect(db.settlements).toContainEqual(
      expect.objectContaining({
        p_delivery_id: 'receipt-wait',
        p_outcome: 'ticketed',
        p_ticket_id: 'ticket-wait',
        p_next_attempt_at: '2026-09-03T12:15:00.000Z',
      })
    );
    expect(db.settlements).toContainEqual(
      expect.objectContaining({
        p_delivery_id: 'send-retry',
        p_outcome: 'retry',
        p_next_attempt_at: '2026-09-03T12:01:00.000Z',
      })
    );
  });

  it('fails a transient send after the bounded attempt limit', async () => {
    const db = adminFor({
      deliveries: [
        {
          delivery_id: 'send-exhausted',
          expo_push_token: 'ExponentPushToken[retry]',
          title: 'Ada',
          body: 'Hello',
          payload: { version: 1 },
          attempt_count: 8,
          cancelled_count: 0,
        },
      ],
    });
    const transport: ExpoPushTransport = {
      receipts: vi.fn(async () => []),
      send: vi.fn(async (): Promise<ExpoPushOutcome[]> => [
        {
          deliveryId: 'send-exhausted',
          kind: 'retry',
          code: 'expo_http_503',
        },
      ]),
    };

    const result = await drainPushDeliveries({
      admin: db.admin,
      transport,
      workerId: WORKER_ID,
    });

    expect(result.failed).toBe(1);
    expect(db.settlements).toContainEqual(
      expect.objectContaining({
        p_outcome: 'failed',
        p_error_code: 'retry_exhausted',
      })
    );
  });

  it('never logs tokens, titles, bodies, contact names, or phones', async () => {
    const token = 'ExponentPushToken[secret-token]';
    const title = 'Private Contact';
    const body = 'Private message 919876543210';
    const db = adminFor({
      deliveries: [
        {
          delivery_id: 'delivery-secret',
          expo_push_token: token,
          title,
          body,
          payload: { version: 1 },
          attempt_count: 1,
          cancelled_count: 0,
        },
      ],
    });
    const transport: ExpoPushTransport = {
      receipts: vi.fn(async () => []),
      send: vi.fn(async () => {
        throw new Error(`${token} ${title} ${body}`);
      }),
    };
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await drainPushDeliveries({
      admin: db.admin,
      transport,
      workerId: WORKER_ID,
    });

    const logs = JSON.stringify(error.mock.calls);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(title);
    expect(logs).not.toContain(body);
    expect(logs).not.toContain('919876543210');
    error.mockRestore();
  });
});
