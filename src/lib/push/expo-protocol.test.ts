import { describe, expect, it, vi } from 'vitest';

import {
  backoffMs,
  classifyExpoError,
  createExpoPushTransport,
  type ClaimedPushDelivery,
} from './expo-protocol';

function delivery(index: number): ClaimedPushDelivery {
  return {
    deliveryId: `delivery-${index}`,
    expoPushToken: `ExponentPushToken[token-${index}]`,
    title: `Contact ${index}`,
    body: `Message ${index}`,
    payload: {
      version: 1,
      accountId: '11111111-1111-4111-8111-111111111111',
      conversationId: '22222222-2222-4222-8222-222222222222',
      messageId: '33333333-3333-4333-8333-333333333333',
      deliveryId: '44444444-4444-4444-8444-444444444444',
    },
    attemptCount: 1,
  };
}

describe('Expo push protocol', () => {
  it('uses capped exponential backoff with injected jitter', () => {
    expect(backoffMs(1, () => 0)).toBe(30_000);
    expect(backoffMs(2, () => 0.5)).toBe(90_000);
    expect(backoffMs(20, () => 1)).toBe(3_600_000);
  });

  it.each([
    [
      'DeviceNotRegistered',
      { kind: 'permanent_token', code: 'DeviceNotRegistered' },
    ],
    [
      'InvalidExpoPushToken',
      { kind: 'permanent_token', code: 'InvalidExpoPushToken' },
    ],
    ['MessageRateExceeded', { kind: 'retry', code: 'MessageRateExceeded' }],
    ['MessageTooBig', { kind: 'failed', code: 'MessageTooBig' }],
    ['InvalidCredentials', { kind: 'failed', code: 'InvalidCredentials' }],
    [
      'unknown provider prose with PII',
      { kind: 'retry', code: 'unexpected_provider_error' },
    ],
  ])('classifies %s safely', (code, expected) => {
    expect(classifyExpoError({ details: { error: code } })).toEqual(expected);
  });

  it('chunks sends at 100 and preserves indexed ticket outcomes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: Array.from({ length: 100 }, (_, index) => ({
            status: 'ok',
            id: `ticket-${index}`,
          })),
        })
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ status: 'ok', id: 'ticket-100' }] })
      );
    const transport = createExpoPushTransport({ fetch });

    const outcomes = await transport.send(
      Array.from({ length: 101 }, (_, index) => delivery(index))
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcomes).toHaveLength(101);
    expect(outcomes[0]).toEqual({
      deliveryId: 'delivery-0',
      kind: 'ticketed',
      ticketId: 'ticket-0',
    });
    const firstBody = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(firstBody).toHaveLength(100);
    expect(firstBody[0]).toMatchObject({
      sound: 'default',
      channelId: 'messages',
      priority: 'high',
    });
  });

  it('isolates partial ticket errors and retries whole-request failures', async () => {
    const partialFetch = vi.fn(async () =>
      Response.json({
        data: [
          { status: 'ok', id: 'ticket-1' },
          {
            status: 'error',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      })
    );
    const transport = createExpoPushTransport({ fetch: partialFetch });

    await expect(transport.send([delivery(1), delivery(2)])).resolves.toEqual([
      { deliveryId: 'delivery-1', kind: 'ticketed', ticketId: 'ticket-1' },
      {
        deliveryId: 'delivery-2',
        kind: 'permanent_token',
        code: 'DeviceNotRegistered',
      },
    ]);

    const retryTransport = createExpoPushTransport({
      fetch: vi.fn(async () => new Response('', { status: 503 })),
    });
    await expect(retryTransport.send([delivery(3)])).resolves.toEqual([
      { deliveryId: 'delivery-3', kind: 'retry', code: 'expo_http_503' },
    ]);
  });

  it('maps receipt success, delay, transient, and permanent token errors', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          'ticket-ok': { status: 'ok' },
          'ticket-rate': {
            status: 'error',
            details: { error: 'MessageRateExceeded' },
          },
          'ticket-dead': {
            status: 'error',
            details: { error: 'DeviceNotRegistered' },
          },
        },
      })
    );
    const transport = createExpoPushTransport({ fetch });

    await expect(
      transport.receipts([
        { deliveryId: 'delivery-ok', ticketId: 'ticket-ok', attemptCount: 1 },
        {
          deliveryId: 'delivery-wait',
          ticketId: 'ticket-wait',
          attemptCount: 1,
        },
        {
          deliveryId: 'delivery-rate',
          ticketId: 'ticket-rate',
          attemptCount: 1,
        },
        {
          deliveryId: 'delivery-dead',
          ticketId: 'ticket-dead',
          attemptCount: 1,
        },
      ])
    ).resolves.toEqual([
      { deliveryId: 'delivery-ok', kind: 'delivered' },
      {
        deliveryId: 'delivery-wait',
        kind: 'receipt_pending',
        code: 'receipt_not_ready',
      },
      {
        deliveryId: 'delivery-rate',
        kind: 'retry',
        code: 'MessageRateExceeded',
      },
      {
        deliveryId: 'delivery-dead',
        kind: 'permanent_token',
        code: 'DeviceNotRegistered',
      },
    ]);
  });

  it('turns malformed provider responses into sanitized retries', async () => {
    const fetch = vi.fn(async () => Response.json({ data: 'secret body' }));
    const transport = createExpoPushTransport({ fetch });

    await expect(transport.send([delivery(1)])).resolves.toEqual([
      {
        deliveryId: 'delivery-1',
        kind: 'retry',
        code: 'unexpected_provider_response',
      },
    ]);
  });
});
