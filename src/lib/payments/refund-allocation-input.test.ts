import { describe, expect, it } from 'vitest';

import {
  normalizeRefundLineAllocations,
  refundAllocationTotalPaise,
} from './refund-allocation-input';

const lineId = '550e8400-e29b-41d4-a716-446655440000';

describe('partial refund line-allocation input', () => {
  it('normalizes explicit positive paise amounts', () => {
    const result = normalizeRefundLineAllocations([
      { invoiceLineId: lineId, amount: '1' },
    ]);
    expect(result).toEqual([{ invoiceLineId: lineId, amount: '1.00' }]);
    expect(refundAllocationTotalPaise(result!)).toBe(100);
  });

  it('treats omitted targeting as the existing full-refund classification path', () => {
    expect(normalizeRefundLineAllocations(undefined)).toEqual([]);
  });

  it.each([
    { value: [] },
    { value: [{ invoiceLineId: 'not-a-uuid', amount: '1.00' }] },
    { value: [{ invoiceLineId: lineId, amount: '0' }] },
    { value: [{ invoiceLineId: lineId, amount: '1.001' }] },
    {
      value: [
        { invoiceLineId: lineId, amount: '0.50' },
        { invoiceLineId: lineId, amount: '0.50' },
      ],
    },
  ])(
    'rejects malformed, empty, or duplicate targeting: $value',
    ({ value }) => {
      expect(normalizeRefundLineAllocations(value)).toBeNull();
    }
  );
});
