import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireOperationalAccess, runAutomationsForTrigger } = vi.hoisted(
  () => ({
    requireOperationalAccess: vi.fn(),
    runAutomationsForTrigger: vi.fn(),
  })
);

vi.mock('@/lib/auth/account', () => ({
  requireOperationalAccess,
  toErrorResponse: (err: { status?: number; message?: string }) =>
    Response.json(
      { error: err.message ?? 'Internal server error' },
      { status: err.status ?? 500 }
    ),
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger,
}));

import { POST } from './route';

function request() {
  return new Request('http://localhost/api/automations/engine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trigger_type: 'manual',
      contact_id: 'contact-1',
    }),
  });
}

describe('POST /api/automations/engine authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches for an authorized agent in the current tenant', async () => {
    requireOperationalAccess.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'agent-1',
      role: 'agent',
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(runAutomationsForTrigger).toHaveBeenCalledWith({
      accountId: 'acct-1',
      triggerType: 'manual',
      contactId: 'contact-1',
      context: {},
    });
  });

  it('denies a viewer before dispatch', async () => {
    requireOperationalAccess.mockRejectedValue({
      status: 403,
      message: 'This action requires operational access',
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('denies a removed former member before dispatch', async () => {
    requireOperationalAccess.mockRejectedValue({
      status: 403,
      message: 'Profile is not linked to an account',
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });
});
