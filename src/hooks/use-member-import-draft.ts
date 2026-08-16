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
  const draftRef = useRef<MemberImportDraftClientRecord | null>(null);
  const pendingRef = useRef<MemberImportDraftState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const conflictRef = useRef(false);

  const adopt = useCallback((next: MemberImportDraftClientRecord | null) => {
    draftRef.current = next;
    pendingRef.current = null;
    conflictRef.current = false;
    setDraft(next);
    setLastAcknowledgedRevision(next?.revision ?? null);
    setSaveState(next ? 'saved' : 'idle');
  }, []);

  const performSave = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current;
    const current = draftRef.current;
    const state = pendingRef.current;
    if (!current || !state) return true;
    pendingRef.current = null;
    setSaveState('saving');

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
          revision?: number;
          saved_at?: string;
        } | null;
        if (
          !response.ok ||
          !result?.ok ||
          typeof result.revision !== 'number'
        ) {
          pendingRef.current ??= state;
          conflictRef.current = result?.code === 'draft_conflict';
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
        setSaveState('saved');
        return true;
      } catch {
        pendingRef.current ??= state;
        setSaveState('error');
        return false;
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = request;
    return request;
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
    if (inFlightRef.current) {
      const succeeded = await inFlightRef.current;
      if (!succeeded) return false;
    }
    return performSave();
  }, [performSave]);

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
    adopt,
    load,
    reload: load,
    initialize,
    save,
    flush,
    discard,
  };
}
