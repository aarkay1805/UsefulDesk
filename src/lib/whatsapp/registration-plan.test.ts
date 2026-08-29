import { describe, expect, it } from 'vitest';
import { planEmbeddedRegistration } from './registration-plan';

describe('planEmbeddedRegistration', () => {
  it('preserves a successful registration when reconnecting the same number', () => {
    expect(
      planEmbeddedRegistration(
        {
          phoneNumberId: 'PNID_123',
          registeredAt: '2026-08-20T12:00:00.000Z',
        },
        'PNID_123'
      )
    ).toEqual({
      shouldRegister: false,
      registeredAt: '2026-08-20T12:00:00.000Z',
    });
  });

  it('registers a different number instead of reusing stale state', () => {
    expect(
      planEmbeddedRegistration(
        {
          phoneNumberId: 'PNID_OLD',
          registeredAt: '2026-08-20T12:00:00.000Z',
        },
        'PNID_NEW'
      )
    ).toEqual({ shouldRegister: true, registeredAt: null });
  });

  it('retries registration when an earlier attempt never succeeded', () => {
    expect(
      planEmbeddedRegistration(
        { phoneNumberId: 'PNID_123', registeredAt: null },
        'PNID_123'
      )
    ).toEqual({ shouldRegister: true, registeredAt: null });
  });
});
