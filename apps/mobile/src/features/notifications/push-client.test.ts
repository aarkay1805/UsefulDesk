import { PushClientError, createPushClient } from './push-client';

const registration = {
  installationId: '11111111-1111-4111-8111-111111111111',
  expoPushToken: 'ExponentPushToken[test]',
  platform: 'ios' as const,
  environment: 'preview' as const,
  appVersion: '1.2.3',
  deviceModel: 'iPhone',
  osVersion: '18.0',
};

describe('mobile push client', () => {
  it('sends exact authenticated PUT and DELETE requests', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    const client = createPushClient({
      baseUrl: 'https://desk.example/',
      fetcher,
    });

    await client.register('access-token', registration);
    await client.revoke('access-token', registration.installationId);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://desk.example/api/mobile/push/installation',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(registration),
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://desk.example/api/mobile/push/installation',
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ installationId: registration.installationId }),
      })
    );
  });

  it('classifies authorization failures without exposing response or token data', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(
        new Response('ExponentPushToken[secret]', { status: 401 })
      );
    const client = createPushClient({
      baseUrl: 'https://desk.example',
      fetcher,
    });

    const result = client.register('secret-access-token', registration);

    await expect(result).rejects.toEqual(
      expect.objectContaining<Partial<PushClientError>>({
        code: 'unauthorized',
      })
    );
    await expect(result).rejects.not.toThrow(/secret|ExponentPushToken/);
  });
});
