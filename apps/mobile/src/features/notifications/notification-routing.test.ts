import { parsePushDestination } from './notification-routing';

const valid = {
  version: 1,
  accountId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  messageId: '33333333-3333-4333-8333-333333333333',
  deliveryId: '44444444-4444-4444-8444-444444444444',
};

describe('parsePushDestination', () => {
  it('accepts only the exact versioned UUID payload', () => {
    expect(parsePushDestination(valid)).toEqual(valid);
  });

  it.each([
    null,
    'legacy-link',
    { ...valid, version: 2 },
    { ...valid, accountId: 'not-a-uuid' },
    { ...valid, route: '/conversation' },
    (({ deliveryId: _deliveryId, ...rest }) => rest)(valid),
  ])('fails closed for malformed, legacy, or additional data', (data) => {
    expect(parsePushDestination(data)).toBeNull();
  });
});
