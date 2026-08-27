import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireSettingsAccess: vi.fn(),
  getRazorpayConnectionStatus: vi.fn(),
  templateReady: true,
  planReady: true,
  invitationError: false,
}));

vi.mock('@/lib/auth/account', () => ({
  requireSettingsAccess: h.requireSettingsAccess,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ admin: true }),
}));
vi.mock('@/lib/payments/credentials', () => ({
  getRazorpayConnectionStatus: h.getRazorpayConnectionStatus,
}));
vi.mock('@/lib/whatsapp/template-readiness', () => ({
  evaluateTemplateReadiness: () => ({ ready: h.templateReady }),
}));
vi.mock('@/lib/branches/setup', () => ({
  hasBranchSetupPrerequisite: () => h.planReady,
}));

import { GET } from './route';

function resultFor(table: string) {
  if (table === 'whatsapp_config') {
    return { data: { status: 'connected' }, error: null };
  }
  if (table === 'message_templates' || table === 'membership_plans') {
    return { data: [{}], error: null };
  }
  if (table === 'memberships') {
    return { data: null, count: 2, error: null };
  }
  if (table === 'payments') {
    return { data: null, count: 3, error: null };
  }
  if (table === 'account_invitations') {
    return h.invitationError
      ? { data: null, count: null, error: { message: 'unavailable' } }
      : { data: null, count: 1, error: null };
  }
  return { data: null, error: null };
}

function createDb() {
  const from = vi.fn((table: string) => {
    const result = resultFor(table);
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      gt: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  });
  const rpc = vi.fn().mockResolvedValue({
    data: [{ user_id: 'owner' }, { user_id: 'staff' }],
    error: null,
  });
  return { from, rpc };
}

describe('GET /api/onboarding/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.templateReady = true;
    h.planReady = true;
    h.invitationError = false;
    h.getRazorpayConnectionStatus.mockResolvedValue({ configured: true });
    h.requireSettingsAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: createDb(),
    });
  });

  it('returns all eight onboarding signals from one settings-authorized boundary', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: {
        whatsappConnected: true,
        templateApproved: true,
        hasActivePlanPricing: true,
        membershipCount: 2,
        razorpayConnected: true,
        paidPaymentCount: 3,
        teamSize: 2,
        pendingInvites: 1,
      },
    });
    expect(h.requireSettingsAccess).toHaveBeenCalledOnce();
    expect(h.getRazorpayConnectionStatus).toHaveBeenCalledWith(
      { admin: true },
      'account-1'
    );
  });

  it('keeps a failed optional signal incomplete instead of auto-completing it', async () => {
    h.invitationError = true;

    const body = await (await GET()).json();

    expect(body.status.pendingInvites).toBeNull();
  });

  it('rejects callers without account-settings capability before data reads', async () => {
    h.requireSettingsAccess.mockRejectedValue(new Error('Insufficient role'));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Insufficient role' });
    expect(h.getRazorpayConnectionStatus).not.toHaveBeenCalled();
  });
});
