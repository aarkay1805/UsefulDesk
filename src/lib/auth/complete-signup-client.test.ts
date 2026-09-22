// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  clearGymNameDraft,
  completeSignup,
  completionPath,
  dashboardBranchPath,
  GYM_NAME_DRAFT_KEY,
  readGymNameDraft,
  resolveAuthenticatedDefaultBranch,
  saveGymNameDraft,
} from './complete-signup-client';

describe('complete signup client', () => {
  it('stores and clears a same-tab gym-name draft', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    saveGymNameDraft('Iron House', storage);
    expect(values.get(GYM_NAME_DRAFT_KEY)).toBe('Iron House');
    expect(readGymNameDraft(storage)).toBe('Iron House');
    clearGymNameDraft(storage);
    expect(readGymNameDraft(storage)).toBe('');
  });

  it('does not break authentication when session storage throws', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('blocked');
      },
      setItem: () => {
        throw new DOMException('blocked');
      },
      removeItem: () => {
        throw new DOMException('blocked');
      },
    };

    expect(() => saveGymNameDraft('Iron House', storage)).not.toThrow();
    expect(readGymNameDraft(storage)).toBe('');
    expect(() => clearGymNameDraft(storage)).not.toThrow();
  });

  it('catches a browser sessionStorage getter that throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      'sessionStorage'
    );
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked');
      },
    });

    try {
      expect(readGymNameDraft()).toBe('');
      expect(() => saveGymNameDraft('Iron House')).not.toThrow();
      expect(() => clearGymNameDraft()).not.toThrow();
    } finally {
      if (descriptor)
        Object.defineProperty(window, 'sessionStorage', descriptor);
    }
  });

  it('posts the normalized name with an explicit branch and accepts both success statuses', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'completed' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'already_complete' }), {
          status: 200,
        })
      );

    await expect(
      completeSignup('branch/id', 'Iron House', request)
    ).resolves.toBe('completed');
    await expect(
      completeSignup('branch/id', 'Iron House', request)
    ).resolves.toBe('already_complete');
    expect(request).toHaveBeenCalledWith(
      '/api/auth/complete-signup?branch=branch%2Fid',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gymName: 'Iron House' }),
      }
    );
  });

  it('surfaces the API error and rejects an unknown success payload', async () => {
    await expect(
      completeSignup(
        'branch-id',
        'Iron House',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Owner access required' }), {
            status: 403,
          })
        )
      )
    ).rejects.toThrow('Owner access required');

    await expect(
      completeSignup(
        'branch-id',
        'Iron House',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ status: 'unexpected' }), {
            status: 200,
          })
        )
      )
    ).rejects.toThrow('Could not confirm');
  });

  it('resolves the profile default only after verifying membership', async () => {
    const profileMaybeSingle = vi.fn().mockResolvedValue({
      data: { account_id: 'branch-id' },
      error: null,
    });
    const membershipMaybeSingle = vi.fn().mockResolvedValue({
      data: { account_id: 'branch-id' },
      error: null,
    });
    const profileEq = vi.fn(() => ({ maybeSingle: profileMaybeSingle }));
    const membershipUserEq = vi.fn(() => ({
      maybeSingle: membershipMaybeSingle,
    }));
    const membershipAccountEq = vi.fn(() => ({ eq: membershipUserEq }));
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: table === 'profiles' ? profileEq : membershipAccountEq,
      })),
    }));

    await expect(
      resolveAuthenticatedDefaultBranch({ from } as never, 'user-id')
    ).resolves.toBe('branch-id');
    expect(from.mock.calls.map(([table]) => table)).toEqual([
      'profiles',
      'account_memberships',
    ]);
    expect(membershipAccountEq).toHaveBeenCalledWith('account_id', 'branch-id');
    expect(membershipUserEq).toHaveBeenCalledWith('user_id', 'user-id');
  });

  it('builds explicit recovery and dashboard paths', () => {
    expect(completionPath()).toBe('/complete-signup');
    expect(completionPath('branch/id')).toBe(
      '/complete-signup?branch=branch%2Fid'
    );
    expect(dashboardBranchPath('branch/id')).toBe(
      '/dashboard?branch=branch%2Fid'
    );
  });
});
