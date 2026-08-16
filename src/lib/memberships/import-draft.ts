import type { DateOrder } from '@/lib/leads/import-coerce';

export const MEMBER_IMPORT_DRAFT_BUCKET = 'member-import-drafts';
export const MEMBER_IMPORT_DRAFT_VERSION = 1 as const;
export const MEMBER_IMPORT_DRAFT_MAX_STATE_BYTES = 5 * 1024 * 1024;

export type MemberImportDraftErrorCode =
  | 'draft_conflict'
  | 'draft_expired'
  | 'draft_unavailable'
  | 'source_mismatch'
  | 'invalid_state';

export interface MemberImportDraftState {
  version: typeof MEMBER_IMPORT_DRAFT_VERSION;
  step: 1 | 2 | 3 | 4 | 'upload' | 'map' | 'resolve' | 'confirm' | 'receipt';
  worksheet: string | null;
  mapping: Record<string, string> | string[];
  dateOrder: DateOrder;
  recipe: unknown;
  candidates: unknown[];
  resolutions: Record<string, unknown>;
  exclusions: string[];
  receipt: unknown;
}

export interface MemberImportDraftRecord {
  id: string;
  account_id: string;
  author_id: string;
  source_filename: string;
  source_kind: 'csv' | 'xlsx';
  source_size: number;
  source_sha256: string;
  object_path: string;
  selected_worksheet: string | null;
  wizard_step: string;
  mapping: unknown;
  date_order: DateOrder;
  recipe_metadata: unknown;
  state: MemberImportDraftState;
  revision: number;
  saved_at: string;
  expires_at: string;
  status: 'active' | 'cleanup';
  created_at: string;
  updated_at: string;
}

export type MemberImportDraftSaveResult =
  | {
      ok: true;
      revision: number;
      savedAt: string;
      expiresAt: string;
    }
  | {
      ok: false;
      code: Extract<
        MemberImportDraftErrorCode,
        'draft_conflict' | 'draft_expired' | 'draft_unavailable'
      >;
      revision?: number;
    };

interface DraftCasAdapter {
  compareAndSwap(input: {
    id: string;
    revision: number;
    state: MemberImportDraftState;
  }): Promise<MemberImportDraftSaveResult>;
}

function hasForbiddenDraftValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenDraftValue);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      key === 'signedUrl' ||
      key === 'signed_url' ||
      key === 'rawWorkbook' ||
      key === 'raw_workbook' ||
      hasForbiddenDraftValue(nested)
  );
}

export function validateDraftState(
  value: unknown
):
  | { ok: true; state: MemberImportDraftState }
  | { ok: false; code: 'invalid_state' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_state' };
  }
  const state = value as Partial<MemberImportDraftState>;
  if (
    state.version !== MEMBER_IMPORT_DRAFT_VERSION ||
    ![1, 2, 3, 4, 'upload', 'map', 'resolve', 'confirm', 'receipt'].includes(
      state.step as never
    ) ||
    (state.worksheet !== null && typeof state.worksheet !== 'string') ||
    (state.dateOrder !== 'DMY' && state.dateOrder !== 'MDY') ||
    !Array.isArray(state.candidates) ||
    !Array.isArray(state.exclusions) ||
    !state.mapping ||
    typeof state.mapping !== 'object' ||
    !state.resolutions ||
    typeof state.resolutions !== 'object' ||
    hasForbiddenDraftValue(state)
  ) {
    return { ok: false, code: 'invalid_state' };
  }
  try {
    const serialized = JSON.stringify(state);
    if (
      new TextEncoder().encode(serialized).byteLength >
      MEMBER_IMPORT_DRAFT_MAX_STATE_BYTES
    ) {
      return { ok: false, code: 'invalid_state' };
    }
  } catch {
    return { ok: false, code: 'invalid_state' };
  }
  return { ok: true, state: state as MemberImportDraftState };
}

export function draftObjectPath(
  accountId: string,
  authorId: string,
  draftId: string,
  filename: string
): string {
  const safeFilename =
    filename
      .normalize('NFKC')
      .replace(/[\\/\0]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'members.csv';
  return `${accountId}/${authorId}/${draftId}/${safeFilename}`;
}

export async function saveDraft(
  input: { id: string; revision: number; state: MemberImportDraftState },
  adapter: DraftCasAdapter
): Promise<MemberImportDraftSaveResult> {
  const validation = validateDraftState(input.state);
  if (!validation.ok) {
    return { ok: false, code: 'draft_unavailable' };
  }
  return adapter.compareAndSwap({ ...input, state: validation.state });
}
