import { describe, expect, it } from 'vitest';

import {
  memberMatchesSearch,
  resolveMemberSearch,
  resolvedMembershipIds,
} from './search';

const membership = {
  member_number: 1042,
  contact: {
    name: 'Aarav Mehta',
    phone: '+91 98765 43210',
  },
};

describe('memberMatchesSearch', () => {
  it('matches a member name case-insensitively', () => {
    expect(memberMatchesSearch(membership, '  AARAV ')).toBe(true);
  });

  it('matches a partial Member ID', () => {
    expect(memberMatchesSearch(membership, '042')).toBe(true);
  });

  it("keeps Attendance's phone-search behavior", () => {
    expect(memberMatchesSearch(membership, '765 43')).toBe(true);
  });

  it('matches every member for a blank search', () => {
    expect(memberMatchesSearch(membership, '   ')).toBe(true);
  });

  it('rejects a term absent from all searchable fields', () => {
    expect(memberMatchesSearch(membership, 'Priya')).toBe(false);
  });
});

describe('resolveMemberSearch', () => {
  it('keeps non-numeric searches on the existing contact query path', async () => {
    const supabase = {
      from() {
        throw new Error('The database should not be queried');
      },
    } as unknown as Parameters<typeof resolveMemberSearch>[0];

    await expect(resolveMemberSearch(supabase, ' Aarav ')).resolves.toEqual({
      kind: 'contact',
      term: 'Aarav',
    });
  });

  it('resolves numeric name, phone, and partial Member ID matches to membership IDs', async () => {
    const supabase = {
      from() {
        return {
          async select() {
            return {
              data: [
                {
                  id: 'member-id-match',
                  member_number: 1042,
                  contact: { name: 'Aarav', phone: '+91 55555' },
                },
                {
                  id: 'phone-match',
                  member_number: 2001,
                  contact: { name: 'Priya', phone: '+91 10420' },
                },
                {
                  id: 'no-match',
                  member_number: 3001,
                  contact: { name: 'Kabir', phone: '+91 99999' },
                },
              ],
              error: null,
            };
          },
        };
      },
    } as unknown as Parameters<typeof resolveMemberSearch>[0];

    await expect(resolveMemberSearch(supabase, '042')).resolves.toEqual({
      kind: 'membershipIds',
      ids: ['member-id-match', 'phone-match'],
    });
  });

  it('uses a non-matching sentinel for an empty resolved ID set', () => {
    expect(
      resolvedMembershipIds({ kind: 'membershipIds', ids: [] })
    ).toHaveLength(1);
  });
});
