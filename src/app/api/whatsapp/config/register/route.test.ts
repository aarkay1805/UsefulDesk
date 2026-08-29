import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireSettingsAccess: vi.fn(),
  decrypt: vi.fn(),
  registerPhoneNumber: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireSettingsAccess: h.requireSettingsAccess,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 403 }
    ),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: h.decrypt }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  registerPhoneNumber: h.registerPhoneNumber,
}));

import { POST } from './route';

function request(pin: string) {
  return new Request('https://desk.example/api/whatsapp/config/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

function createDb() {
  const updateSelect = vi
    .fn()
    .mockResolvedValue({ data: [{ id: 'config-1' }], error: null });
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn((values: Record<string, unknown>) => {
    void values;
    return { eq: updateEq };
  });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'config-1',
      phone_number_id: 'PNID_123',
      access_token: 'encrypted-token',
    },
    error: null,
  });
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const from = vi.fn(() => ({ select, update }));
  return { from, update, updateEq, updateSelect };
}

describe('POST /api/whatsapp/config/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.decrypt.mockReturnValue('stored-access-token');
    h.registerPhoneNumber.mockResolvedValue({
      success: true,
      alreadyRegistered: false,
    });
  });

  it('registers with the saved token and repairs local delivery state', async () => {
    const db = createDb();
    h.requireSettingsAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: db,
    });

    const response = await POST(request('123456'));

    expect(response.status).toBe(200);
    expect(h.decrypt).toHaveBeenCalledWith('encrypted-token');
    expect(h.registerPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'PNID_123',
      accessToken: 'stored-access-token',
      pin: '123456',
    });
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'connected',
        last_registration_error: null,
      })
    );
    const updatePayload = db.update.mock.calls[0][0];
    expect(updatePayload.registered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await response.json()).toEqual({ success: true });
  });

  it('records a PIN mismatch and returns an actionable provider error', async () => {
    const db = createDb();
    h.requireSettingsAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: db,
    });
    h.registerPhoneNumber.mockRejectedValue(
      new Error('(#133005) Two step verification PIN Mismatch')
    );

    const response = await POST(request('654321'));

    expect(response.status).toBe(400);
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        registered_at: null,
        last_registration_error: '(#133005) Two step verification PIN Mismatch',
      })
    );
    expect(await response.json()).toEqual({
      error: '(#133005) Two step verification PIN Mismatch',
    });
  });

  it('rejects malformed PINs before calling Meta', async () => {
    h.requireSettingsAccess.mockResolvedValue({
      accountId: 'account-1',
      supabase: createDb(),
    });

    const response = await POST(request('12345'));

    expect(response.status).toBe(400);
    expect(h.registerPhoneNumber).not.toHaveBeenCalled();
  });
});
