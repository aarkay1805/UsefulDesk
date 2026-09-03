import { describe, expect, it, vi } from 'vitest';

import {
  type InstallationInput,
  parseInstallationInput,
  revokePushInstallation,
  upsertPushInstallation,
} from './installation-store';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'ExponentPushToken[synthetic-token]';

const valid = {
  installationId: INSTALLATION_ID,
  expoPushToken: TOKEN,
  platform: 'ios',
  environment: 'preview',
  appVersion: '1.2.3',
  deviceModel: 'iPhone',
  osVersion: '18.0',
} satisfies InstallationInput;

describe('push installation input', () => {
  it('normalizes a valid installation payload', () => {
    expect(parseInstallationInput(valid)).toEqual(valid);
  });

  it.each([
    [{ ...valid, installationId: 'not-a-uuid' }, 'installationId'],
    [{ ...valid, expoPushToken: 'token' }, 'expoPushToken'],
    [{ ...valid, platform: 'web' }, 'platform'],
    [{ ...valid, environment: 'test' }, 'environment'],
    [{ ...valid, appVersion: 'x'.repeat(65) }, 'appVersion'],
    [{ ...valid, deviceModel: 'x'.repeat(121) }, 'deviceModel'],
    [{ ...valid, userId: USER_ID }, 'unknown'],
  ])('rejects invalid or authority-bearing input %#', (input, message) => {
    expect(() => parseInstallationInput(input)).toThrow(message);
  });
});

describe('push installation store', () => {
  it('registers with authenticated identity and returns no token', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { installation_id: INSTALLATION_ID, registration_status: 'registered' },
      ],
      error: null,
    }));

    await expect(
      upsertPushInstallation({ rpc } as never, USER_ID, valid)
    ).resolves.toEqual({
      installationId: INSTALLATION_ID,
      status: 'registered',
    });
    expect(rpc).toHaveBeenCalledWith('register_push_installation', {
      p_user_id: USER_ID,
      p_installation_id: INSTALLATION_ID,
      p_platform: 'ios',
      p_environment: 'preview',
      p_expo_push_token: TOKEN,
      p_app_version: '1.2.3',
      p_device_model: 'iPhone',
      p_os_version: '18.0',
    });
    expect(
      JSON.stringify(
        await upsertPushInstallation({ rpc } as never, USER_ID, valid)
      )
    ).not.toContain(TOKEN);
  });

  it('makes exact authenticated revocation idempotent', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(
      revokePushInstallation({ rpc } as never, USER_ID, INSTALLATION_ID)
    ).resolves.toEqual({ installationId: INSTALLATION_ID, status: 'revoked' });
    await expect(
      revokePushInstallation({ rpc } as never, USER_ID, INSTALLATION_ID)
    ).resolves.toEqual({ installationId: INSTALLATION_ID, status: 'revoked' });
    expect(rpc).toHaveBeenCalledWith('revoke_push_installation', {
      p_user_id: USER_ID,
      p_installation_id: INSTALLATION_ID,
    });
  });

  it('collapses database failures without provider or token details', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: `duplicate ${TOKEN}` },
    }));

    await expect(
      upsertPushInstallation({ rpc } as never, USER_ID, valid)
    ).rejects.toThrow('Could not register push installation');
    await expect(
      upsertPushInstallation({ rpc } as never, USER_ID, valid)
    ).rejects.not.toThrow(TOKEN);
  });
});
