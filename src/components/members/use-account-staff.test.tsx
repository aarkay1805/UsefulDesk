// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accountId: null as string | null,
  rpc: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: mocks.accountId }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    // A multi-branch teammate's legacy profile account differs from the
    // selected branch. The old direct query therefore returns no rows.
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    }),
  }),
}));

import { invalidateAccountStaff, useAccountStaff } from './use-account-staff';

afterEach(cleanup);

function rosterRow(userId: string, name: string) {
  return {
    user_id: userId,
    full_name: name,
    email: null,
    avatar_url: `/avatars/${userId}.webp`,
    role: 'agent',
    joined_at: '2026-09-28T10:00:00Z',
  };
}

describe('branch team-member identities', () => {
  it('resolves names and photos for teammates whose profile belongs to another branch', async () => {
    mocks.accountId = 'branch-roster';
    mocks.rpc.mockImplementation(async (name, args) =>
      name === 'list_account_members' && args.p_account_id === 'branch-roster'
        ? {
            data: [rosterRow('rep-b', 'Zara'), rosterRow('rep-a', 'Asha')],
            error: null,
          }
        : { data: [], error: null }
    );

    const { result } = renderHook(useAccountStaff);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect([...result.current.nameById]).toEqual([
      ['rep-a', 'Asha'],
      ['rep-b', 'Zara'],
    ]);
    expect(result.current.avatarById.get('rep-a')).toBe('/avatars/rep-a.webp');
    expect(result.current.error).toBeNull();
  });

  it('refreshes the shared identity maps after a teammate changes their name', async () => {
    mocks.accountId = 'branch-refresh';
    mocks.rpc.mockResolvedValue({
      data: [rosterRow('rep', 'Asha')],
      error: null,
    });
    const first = renderHook(useAccountStaff);
    const second = renderHook(useAccountStaff);
    await waitFor(() =>
      expect(first.result.current.nameById.get('rep')).toBe('Asha')
    );

    mocks.rpc.mockResolvedValue({
      data: [rosterRow('rep', 'Asha Rao')],
      error: null,
    });
    act(() => invalidateAccountStaff('branch-refresh'));

    await waitFor(() =>
      expect(first.result.current.nameById.get('rep')).toBe('Asha Rao')
    );
    expect(second.result.current.nameById.get('rep')).toBe('Asha Rao');
  });

  it('never shows the previous branch roster while the next branch loads', async () => {
    mocks.accountId = 'branch-before';
    mocks.rpc.mockResolvedValue({
      data: [rosterRow('rep-before', 'Asha')],
      error: null,
    });
    const { result, rerender } = renderHook(useAccountStaff);
    await waitFor(() =>
      expect(result.current.nameById.get('rep-before')).toBe('Asha')
    );

    mocks.accountId = 'branch-after';
    mocks.rpc.mockResolvedValue({
      data: [rosterRow('rep-after', 'Zara')],
      error: null,
    });
    rerender();
    expect(result.current.nameById.has('rep-before')).toBe(false);
    await waitFor(() =>
      expect(result.current.nameById.get('rep-after')).toBe('Zara')
    );
  });

  it('exposes roster failures and recovers when refreshed', async () => {
    mocks.accountId = 'branch-failure';
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Branch context is invalid' },
    });
    const { result } = renderHook(useAccountStaff);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('Branch context is invalid');

    mocks.rpc.mockResolvedValue({
      data: [rosterRow('rep', 'Asha')],
      error: null,
    });
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.nameById.get('rep')).toBe('Asha')
    );
    expect(result.current.error).toBeNull();
  });
});
