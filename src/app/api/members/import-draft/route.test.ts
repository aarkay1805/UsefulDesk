import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: () => Response.json({ error: 'failed' }, { status: 500 }),
}));

import { PATCH } from './route';

const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const state = {
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

describe('member import draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireRole.mockResolvedValue({
      accountId: 'account-1',
      userId: 'author-1',
      role: 'agent',
      supabase: { rpc: h.rpc },
    });
  });

  it('returns a stable conflict response for a stale revision', async () => {
    h.rpc.mockResolvedValue({
      data: { ok: false, code: 'draft_conflict', revision: 5 },
      error: null,
    });

    const response = await PATCH(
      new Request('https://desk.example/api/members/import-draft', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: DRAFT_ID, revision: 4, state }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'draft_conflict',
      revision: 5,
    });
    expect(h.rpc).toHaveBeenCalledWith('save_member_import_draft', {
      p_draft_id: DRAFT_ID,
      p_expected_revision: 4,
      p_state: state,
    });
  });

  it('rejects normalized state that contains a signed URL', async () => {
    const response = await PATCH(
      new Request('https://desk.example/api/members/import-draft', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: DRAFT_ID,
          revision: 4,
          state: { ...state, signedUrl: 'https://private.example' },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
