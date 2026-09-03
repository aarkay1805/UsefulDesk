import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  upsertPushInstallation: vi.fn(),
  revokePushInstallation: vi.fn(),
  parseInstallationInput: vi.fn(),
  admin: { rpc: vi.fn() },
}));

vi.mock('@/lib/auth/mobile-user-access', () => ({
  requireMobileUser: h.requireMobileUser,
}));

vi.mock('@/lib/push/admin-client', () => ({
  pushAdmin: () => h.admin,
}));

vi.mock('@/lib/push/installation-store', () => ({
  parseInstallationInput: h.parseInstallationInput,
  upsertPushInstallation: h.upsertPushInstallation,
  revokePushInstallation: h.revokePushInstallation,
  parseRevocationInput: (value: unknown) => value,
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (error: { status?: number; message?: string }) =>
    Response.json(
      { error: error.message ?? 'Internal server error' },
      { status: error.status ?? 500 }
    ),
}));

import { DELETE, PUT } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'ExponentPushToken[synthetic-secret-token]';

function request(method: 'PUT' | 'DELETE', body: unknown) {
  return new Request('https://desk.example/api/mobile/push/installation', {
    method,
    headers: {
      authorization: 'Bearer access-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/mobile/push/installation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireMobileUser.mockResolvedValue({
      userId: USER_ID,
      accessToken: 'access-token',
    });
    h.parseInstallationInput.mockImplementation((value) => value);
    h.upsertPushInstallation.mockResolvedValue({
      installationId: INSTALLATION_ID,
      status: 'registered',
    });
    h.revokePushInstallation.mockResolvedValue({
      installationId: INSTALLATION_ID,
      status: 'revoked',
    });
  });

  it('authenticates before parsing or mutating registration input', async () => {
    const input = {
      installationId: INSTALLATION_ID,
      expoPushToken: TOKEN,
      platform: 'android',
      environment: 'development',
    };
    const req = request('PUT', input);

    const response = await PUT(req);

    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({
      installationId: INSTALLATION_ID,
      status: 'registered',
    });
    expect(h.requireMobileUser).toHaveBeenCalledWith(req);
    expect(h.parseInstallationInput).toHaveBeenCalledWith(input);
    expect(h.upsertPushInstallation).toHaveBeenCalledWith(
      h.admin,
      USER_ID,
      input
    );
    expect(responseText).not.toContain(TOKEN);
  });

  it('never falls back to a supplied user id', async () => {
    const input = {
      installationId: INSTALLATION_ID,
      expoPushToken: TOKEN,
      userId: '99999999-9999-4999-8999-999999999999',
    };

    await PUT(request('PUT', input));

    expect(h.upsertPushInstallation).toHaveBeenCalledWith(
      h.admin,
      USER_ID,
      input
    );
  });

  it('returns 401 before body parsing when bearer validation fails', async () => {
    h.requireMobileUser.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 })
    );
    const req = new Request(
      'https://desk.example/api/mobile/push/installation',
      { method: 'PUT', body: '{broken' }
    );

    const response = await PUT(req);

    expect(response.status).toBe(401);
    expect(h.parseInstallationInput).not.toHaveBeenCalled();
  });

  it('maps malformed JSON and validation failures to 400', async () => {
    const malformed = await PUT(
      new Request('https://desk.example/api/mobile/push/installation', {
        method: 'PUT',
        headers: { authorization: 'Bearer access-token' },
        body: '{broken',
      })
    );
    h.parseInstallationInput.mockImplementationOnce(() => {
      throw new Error('Invalid installationId');
    });
    const invalid = await PUT(request('PUT', { installationId: 'bad' }));

    expect(malformed.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'Invalid push installation',
    });
  });

  it('revokes the exact authenticated installation idempotently', async () => {
    const input = { installationId: INSTALLATION_ID };
    const response = await DELETE(request('DELETE', input));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      installationId: INSTALLATION_ID,
      status: 'revoked',
    });
    expect(h.revokePushInstallation).toHaveBeenCalledWith(
      h.admin,
      USER_ID,
      INSTALLATION_ID
    );
  });

  it('returns a generic 500 response without logging token-bearing errors', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    h.upsertPushInstallation.mockRejectedValue(
      new Error(`provider rejected ${TOKEN}`)
    );

    const response = await PUT(
      request('PUT', { installationId: INSTALLATION_ID, expoPushToken: TOKEN })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Push installation unavailable',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
    error.mockRestore();
  });
});
