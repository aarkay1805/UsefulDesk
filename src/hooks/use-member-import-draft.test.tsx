// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberImportDraftState } from '@/lib/memberships/import-draft';
import { useMemberImportDraft } from './use-member-import-draft';

const state: MemberImportDraftState = {
  version: 1,
  step: 2,
  worksheet: 'Members',
  mapping: ['phone', 'plan'],
  dateOrder: 'DMY',
  recipe: null,
  candidates: [],
  resolutions: {},
  exclusions: [],
  receipt: null,
};

describe('useMemberImportDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports saved only after the server acknowledges the next revision', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        revision: 3,
        saved_at: '2026-08-16T10:00:00.000Z',
        expires_at: '2026-09-15T10:00:00.000Z',
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useMemberImportDraft({ debounceMs: 50 })
    );

    act(() => {
      result.current.adopt({
        id: 'draft-1',
        revision: 2,
        sourceFilename: 'members.csv',
        state,
      });
      result.current.save(state);
    });
    expect(result.current.saveState).toBe('saving');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.saveState).toBe('saved');
    expect(result.current.lastAcknowledgedRevision).toBe(3);
  });

  it('keeps close blocked when a flush fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: false }, { status: 500 }))
    );
    const { result } = renderHook(() => useMemberImportDraft());
    act(() => {
      result.current.adopt({
        id: 'draft-1',
        revision: 2,
        sourceFilename: 'members.csv',
        state,
      });
      result.current.save(state);
    });

    let closed = true;
    await act(async () => {
      closed = await result.current.flush();
    });

    expect(closed).toBe(false);
    expect(result.current.saveState).toBe('error');
  });
});
