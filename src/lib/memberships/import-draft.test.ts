import { describe, expect, it } from 'vitest';

import {
  draftObjectPath,
  saveDraft,
  validateDraftState,
  type MemberImportDraftState,
} from './import-draft';

const STATE: MemberImportDraftState = {
  version: 1,
  step: 'resolve',
  worksheet: 'Members',
  mapping: { Phone: 'phone' },
  dateOrder: 'DMY',
  recipe: null,
  candidates: [],
  resolutions: {},
  exclusions: [],
  receipt: null,
};

describe('member import draft validation', () => {
  it('accepts normalized wizard state', () => {
    expect(validateDraftState(STATE)).toEqual({ ok: true, state: STATE });
  });

  it('rejects signed URLs anywhere in normalized state', () => {
    expect(
      validateDraftState({
        ...STATE,
        recipe: { signedUrl: 'https://private.example/object' },
      })
    ).toEqual({ ok: false, code: 'invalid_state' });
  });

  it('builds an author-private object path', () => {
    expect(
      draftObjectPath('account-1', 'author-1', 'draft-1', 'members.xlsx')
    ).toBe('account-1/author-1/draft-1/members.xlsx');
  });
});

describe('member import draft compare-and-swap', () => {
  it('rejects a stale revision without accepting its state', async () => {
    const result = await saveDraft(
      { id: 'draft-1', revision: 4, state: STATE },
      {
        compareAndSwap: async () => ({
          ok: false,
          code: 'draft_conflict',
          revision: 5,
        }),
      }
    );

    expect(result).toEqual({
      ok: false,
      code: 'draft_conflict',
      revision: 5,
    });
  });
});
