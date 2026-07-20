import { describe, expect, it } from 'vitest';

import { parseMemberNumber } from './member-number';

describe('parseMemberNumber', () => {
  it('accepts a positive integer with surrounding whitespace', () => {
    expect(parseMemberNumber(' 1001 ')).toBe(1001);
  });

  it.each(['', '   ', '0', '-1', '+1001', '10.5', 'member-1001'])(
    'rejects %j',
    (value) => {
      expect(parseMemberNumber(value)).toBeNull();
    }
  );

  it("rejects integers outside JavaScript's safe range", () => {
    expect(parseMemberNumber('9007199254740992')).toBeNull();
  });
});
