import { describe, expect, it } from 'vitest';
import {
  branchHref,
  branchIdFromUrl,
  isBranchAccountId,
} from './branch-context';

const A = '11111111-1111-4111-8111-111111111111';

describe('branch context', () => {
  it('accepts UUID branch ids and rejects malformed values', () => {
    expect(isBranchAccountId(A)).toBe(true);
    expect(isBranchAccountId('not-a-branch')).toBe(false);
  });

  it('reads a durable branch query parameter', () => {
    expect(branchIdFromUrl(`/members?branch=${A}&tab=all`)).toBe(A);
    expect(branchIdFromUrl('/members?branch=forged')).toBeNull();
  });

  it('preserves existing query and hash state when scoping a link', () => {
    expect(branchHref('/members?tab=renewals#queue', A)).toBe(
      `/members?tab=renewals&branch=${A}#queue`
    );
  });
});
