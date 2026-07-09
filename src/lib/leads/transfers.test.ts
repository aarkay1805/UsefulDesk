import { describe, expect, it } from 'vitest';
import type { LeadTransfer } from '@/types';
import { isIncomingTo, pendingTransferMap } from './transfers';

function transfer(over: Partial<LeadTransfer>): LeadTransfer {
  return {
    id: 't1',
    account_id: 'a1',
    contact_id: 'c1',
    from_user_id: 'u-from',
    to_user_id: 'u-to',
    requested_by: 'u-from',
    status: 'pending',
    created_at: '2026-07-09T00:00:00Z',
    ...over,
  };
}

describe('pendingTransferMap', () => {
  it('indexes pending transfers by contact_id', () => {
    const map = pendingTransferMap([
      transfer({ id: 't1', contact_id: 'c1' }),
      transfer({ id: 't2', contact_id: 'c2' }),
    ]);
    expect(map.c1?.id).toBe('t1');
    expect(map.c2?.id).toBe('t2');
  });

  it('ignores non-pending rows', () => {
    const map = pendingTransferMap([
      transfer({ contact_id: 'c1', status: 'accepted' }),
      transfer({ contact_id: 'c2', status: 'declined' }),
    ]);
    expect(map).toEqual({});
  });

  it('last pending wins for the same contact (defensive)', () => {
    const map = pendingTransferMap([
      transfer({ id: 'old', contact_id: 'c1' }),
      transfer({ id: 'new', contact_id: 'c1' }),
    ]);
    expect(map.c1?.id).toBe('new');
  });
});

describe('isIncomingTo', () => {
  it('true only for the pending target', () => {
    expect(isIncomingTo(transfer({ to_user_id: 'me' }), 'me')).toBe(true);
    expect(isIncomingTo(transfer({ to_user_id: 'other' }), 'me')).toBe(false);
  });

  it('false once the transfer is resolved', () => {
    expect(
      isIncomingTo(transfer({ to_user_id: 'me', status: 'accepted' }), 'me')
    ).toBe(false);
  });
});
