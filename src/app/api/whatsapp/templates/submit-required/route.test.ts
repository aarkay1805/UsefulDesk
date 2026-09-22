import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireSettingsAccess: vi.fn(),
  runRequiredTemplateSubmission: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireSettingsAccess: h.requireSettingsAccess,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));
vi.mock('@/lib/whatsapp/required-template-submission-server', () => ({
  runRequiredTemplateSubmission: h.runRequiredTemplateSubmission,
}));

import { POST } from './route';

describe('POST /api/whatsapp/templates/submit-required', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects callers without settings edit access before doing any work', async () => {
    h.requireSettingsAccess.mockRejectedValue(new Error('Insufficient role'));

    const response = await POST();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Insufficient role' });
    expect(h.runRequiredTemplateSubmission).not.toHaveBeenCalled();
  });

  it('returns the server workflow aggregate for the authorized account', async () => {
    const ctx = {
      accountId: 'account-1',
      userId: 'user-1',
      supabase: { account: 'account-1' },
    };
    const summary = {
      total: 19,
      submitted: 3,
      already_ready_or_pending: 15,
      failed: 1,
      results: [],
    };
    h.requireSettingsAccess.mockResolvedValue(ctx);
    h.runRequiredTemplateSubmission.mockResolvedValue(summary);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ...summary });
    expect(h.runRequiredTemplateSubmission).toHaveBeenCalledWith(ctx);
  });
});
