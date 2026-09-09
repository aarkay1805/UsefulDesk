'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  MemberImportDraftRecord,
  MemberImportDraftState,
} from '@/lib/memberships/import-draft';

export type MemberImportDraftSaveState =
  'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'conflict';

export interface MemberImportDraftClientRecord {
  id: string;
  revision: number;
  sourceFilename: string;
  sourceKind?: 'csv' | 'xlsx';
  sourceSize?: number;
  sourceSha256?: string;
  signedUrl?: string;
  savedAt?: string;
  state: MemberImportDraftState;
}

interface UseMemberImportDraftOptions {
  debounceMs?: number;
}

function fromApiDraft(
  draft: MemberImportDraftRecord,
  signedUrl?: string
): MemberImportDraftClientRecord {
  return {
    id: draft.id,
    revision: draft.revision,
    sourceFilename: draft.source_filename,
    sourceKind: draft.source_kind,
    sourceSize: draft.source_size,
    sourceSha256: draft.source_sha256,
    signedUrl,
    savedAt: draft.saved_at,
    state: draft.state,
  };
}

export function useMemberImportDraft({
  debounceMs = 700,
}: UseMemberImportDraftOptions = {}) {
  const [draft, setDraft] = useState<MemberImportDraftClientRecord | null>(
    null
  );
  const [saveState, setSaveState] =
    useState<MemberImportDraftSaveState>('idle');
  const [lastAcknowledgedRevision, setLastAcknowledgedRevision] = useState<
    number | null
  >(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const draftRef = useRef<MemberImportDraftClientRecord | null>(null);
  const pendingRef = useRef<MemberImportDraftState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const conflictRef = useRef(false);
  // A reload/adopt can happen while an older PATCH is in flight. Responses from
  // that generation must never replace the newer private draft snapshot.
  const generationRef = useRef(0);

  const adopt = useCallback((next: MemberImportDraftClientRecord | null) => {
    generationRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    draftRef.current = next;
    pendingRef.current = null;
    conflictRef.current = false;
    setDraft(next);
    setLastAcknowledgedRevision(next?.revision ?? null);
    setLastError(null);
    setSaveState(next ? 'saved' : 'idle');
  }, []);

  const performSave = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current;
    const current = draftRef.current;
    const state = pendingRef.current;
    if (!current || !state) return true;
    const generation = generationRef.current;
    pendingRef.current = null;
    setSaveState('saving');

    let requestSucceeded = false;
    const request = (async () => {
      try {
        const response = await fetch('/api/members/import-draft', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: current.id,
            revision: current.revision,
            state,
          }),
        });
        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          code?: string;
          error?: string;
          revision?: number;
          saved_at?: string;
        } | null;
        if (
          generation !== generationRef.current ||
          draftRef.current !== current
        ) {
          // A reload/adopt owns the current state now. The old request is
          // harmless, but its acknowledgement must not advance this draft.
          requestSucceeded = true;
          return true;
        }
        if (
          !response.ok ||
          !result?.ok ||
          typeof result.revision !== 'number'
        ) {
          pendingRef.current ??= state;
          conflictRef.current = result?.code === 'draft_conflict';
          setLastError(result?.error ?? null);
          setSaveState(conflictRef.current ? 'conflict' : 'error');
          return false;
        }
        const acknowledged: MemberImportDraftClientRecord = {
          ...current,
          revision: result.revision,
          savedAt: result.saved_at,
          state,
        };
        draftRef.current = acknowledged;
        setDraft(acknowledged);
        setLastAcknowledgedRevision(result.revision);
        // A timer may have fired while this request was in flight. Do not
        // claim the draft is saved until that newer snapshot is acknowledged.
        if (!pendingRef.current) setSaveState('saved');
        requestSucceeded = true;
        return true;
      } catch {
        if (
          generation !== generationRef.current ||
          draftRef.current !== current
        ) {
          return true;
        }
        pendingRef.current ??= state;
        setLastError('Could not save this private import draft.');
        setSaveState('error');
        return false;
      } finally {
        // A newer save can be queued after this request completes.
        // `inFlightRef` is cleared by the caller below once this promise is
        // installed, so do not disturb a newer generation here.
      }
    })();
    inFlightRef.current = request;
    return request.finally(() => {
      if (inFlightRef.current === request) {
        inFlightRef.current = null;
        if (
          generation === generationRef.current &&
          requestSucceeded &&
          pendingRef.current &&
          !conflictRef.current
        ) {
          void performSave();
        }
      }
    });
  }, []);

  const save = useCallback(
    (state: MemberImportDraftState) => {
      if (!draftRef.current || conflictRef.current) return;
      pendingRef.current = state;
      setSaveState('saving');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void performSave();
      }, debounceMs);
    },
    [debounceMs, performSave]
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    while (true) {
      if (inFlightRef.current) {
        const succeeded = await inFlightRef.current;
        if (!succeeded) return false;
        continue;
      }
      if (conflictRef.current) return false;
      if (!pendingRef.current) return true;
      if (!(await performSave())) return false;
    }
  }, [performSave]);

  /** Persist an exact execution checkpoint before the caller sends its RPC. */
  const saveAndFlush = useCallback(
    async (state: MemberImportDraftState): Promise<boolean> => {
      if (!draftRef.current || conflictRef.current) return false;
      save(state);
      return flush();
    },
    [flush, save]
  );

  const load =
    useCallback(async (): Promise<MemberImportDraftClientRecord | null> => {
      setSaveState('loading');
      try {
        const response = await fetch('/api/members/import-draft', {
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          ok?: boolean;
          draft?: MemberImportDraftRecord | null;
          signed_url?: string;
        };
        if (!response.ok || !result.ok) throw new Error('Draft unavailable');
        const next = result.draft
          ? fromApiDraft(result.draft, result.signed_url)
          : null;
        adopt(next);
        return next;
      } catch {
        setSaveState('error');
        return null;
      }
    }, [adopt]);

  const initialize = useCallback(
    async (
      file: File,
      dateOrder: MemberImportDraftState['dateOrder'],
      state: MemberImportDraftState
    ): Promise<MemberImportDraftClientRecord | null> => {
      setSaveState('saving');
      const form = new FormData();
      form.set('file', file);
      form.set('date_order', dateOrder);
      form.set('state', JSON.stringify(state));
      try {
        const response = await fetch('/api/members/import-draft', {
          method: 'POST',
          body: form,
        });
        const result = (await response.json()) as {
          ok?: boolean;
          draft?: MemberImportDraftRecord;
          signed_url?: string;
        };
        if (!response.ok || !result.ok || !result.draft) {
          setSaveState('error');
          return null;
        }
        const next = fromApiDraft(result.draft, result.signed_url);
        adopt(next);
        return next;
      } catch {
        setSaveState('error');
        return null;
      }
    },
    [adopt]
  );

  const discard = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    if (!current) return true;
    try {
      const response = await fetch(
        `/api/members/import-draft?id=${encodeURIComponent(current.id)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        setSaveState('error');
        return false;
      }
      adopt(null);
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  }, [adopt]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return {
    draft,
    saveState,
    lastAcknowledgedRevision,
    lastError,
    adopt,
    load,
    reload: load,
    initialize,
    save,
    flush,
    saveAndFlush,
    discard,
  };
}
