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

  it('does not let an older in-flight save overwrite a reloaded draft', async () => {
    let resolveSave: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSave = resolve;
          })
      )
    );
    const { result } = renderHook(() =>
      useMemberImportDraft({ debounceMs: 1 })
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    act(() => {
      result.current.adopt({
        id: 'draft-1',
        revision: 9,
        sourceFilename: 'members.csv',
        state: { ...state, step: 3 },
      });
    });
    await act(async () => {
      resolveSave?.(Response.json({ ok: true, revision: 3 }));
      await Promise.resolve();
    });

    expect(result.current.draft?.revision).toBe(9);
    expect(result.current.draft?.state.step).toBe(3);
  });

  it('ignores a rejected old save after adopting a newer draft', async () => {
    let rejectSave: ((error: Error) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useMemberImportDraft({ debounceMs: 1 })
    );
    act(() => {
      result.current.adopt({
        id: 'draft-a',
        revision: 2,
        sourceFilename: 'a.csv',
        state,
      });
      result.current.save(state);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    act(() => {
      result.current.adopt({
        id: 'draft-b',
        revision: 9,
        sourceFilename: 'b.csv',
        state: { ...state, step: 3 },
      });
    });
    await act(async () => {
      rejectSave?.(new Error('offline'));
      await Promise.resolve();
    });

    expect(result.current.draft).toMatchObject({ id: 'draft-b', revision: 9 });
    expect(result.current.saveState).toBe('saved');
    expect(result.current.lastError).toBeNull();
  });

  it('drains a debounced edit queued while another save is in flight', async () => {
    let resolveFirst: ((response: Response) => void) | null = null;
    const newer = { ...state, step: 3 as const };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(Response.json({ ok: true, revision: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() =>
      useMemberImportDraft({ debounceMs: 1 })
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    act(() => result.current.save(newer));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      resolveFirst?.(Response.json({ ok: true, revision: 3 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).state).toEqual(
      newer
    );
    expect(result.current.draft?.revision).toBe(4);
    expect(result.current.saveState).toBe('saved');
  });
});
