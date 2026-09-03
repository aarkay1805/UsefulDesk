import { createNotificationCoordinator } from './notification-coordinator';

const auth = { accessToken: 'access-1', userId: 'user-1' };

function setup() {
  let tokenListener: (() => void) | null = null;
  const removeTokenListener = jest.fn();
  const native = {
    isAvailable: () => true,
    configureForegroundPresentation: jest.fn(),
    ensureMessagesChannel: jest.fn().mockResolvedValue(undefined),
    getPermission: jest
      .fn()
      .mockResolvedValue({ granted: false, canAskAgain: true }),
    requestPermission: jest
      .fn()
      .mockResolvedValue({ granted: true, canAskAgain: true }),
    getExpoPushToken: jest.fn().mockResolvedValue('ExponentPushToken[first]'),
    addPushTokenListener: jest.fn((listener: () => void) => {
      tokenListener = listener;
      return { remove: removeTokenListener };
    }),
    addNotificationResponseListener: jest.fn(() => ({ remove: jest.fn() })),
    getLastNotificationResponse: jest.fn().mockResolvedValue(null),
    openSettings: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    getOrCreateId: jest
      .fn()
      .mockResolvedValue('11111111-1111-4111-8111-111111111111'),
    wasExplanationShown: jest.fn().mockResolvedValue(false),
    markExplanationShown: jest.fn().mockResolvedValue(undefined),
  };
  const push = {
    register: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const coordinator = createNotificationCoordinator({
    native,
    storage,
    push,
    installation: {
      platform: 'ios',
      appEnvironment: 'preview',
      appVersion: '1.2.3',
      deviceModel: 'iPhone',
      osVersion: '18.0',
    },
    refreshAccessToken: jest.fn().mockResolvedValue('access-2'),
  });
  return {
    coordinator,
    native,
    storage,
    push,
    emitToken: (token: string) => {
      native.getExpoPushToken.mockResolvedValueOnce(token);
      tokenListener?.();
    },
    removeTokenListener,
  };
}

describe('notification coordinator', () => {
  it('reports one-time explanation state without prompting automatically', async () => {
    const { coordinator, native } = setup();

    await coordinator.start(auth);

    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'requestable',
      shouldExplain: true,
      canRequest: true,
    });
    expect(native.requestPermission).not.toHaveBeenCalled();
  });

  it('creates the channel before permission and registers an enabled device', async () => {
    const { coordinator, native, push } = setup();
    await coordinator.start(auth);

    await coordinator.requestPermission(auth);

    expect(
      native.ensureMessagesChannel.mock.invocationCallOrder[0]
    ).toBeLessThan(native.requestPermission.mock.invocationCallOrder[0]);
    expect(push.register).toHaveBeenCalledWith(
      'access-1',
      expect.objectContaining({
        installationId: '11111111-1111-4111-8111-111111111111',
        expoPushToken: 'ExponentPushToken[first]',
        appEnvironment: 'preview',
      })
    );
    expect(coordinator.getSnapshot().status).toBe('enabled');
  });

  it('does not repeatedly request a denied system permission', async () => {
    const { coordinator, native } = setup();
    native.getPermission.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    await coordinator.start(auth);

    await coordinator.requestPermission(auth);

    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'denied',
      canRequest: false,
    });
  });

  it('retries registration once with a refreshed access token', async () => {
    const { coordinator, native, push } = setup();
    native.getPermission.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    push.register
      .mockRejectedValueOnce({ code: 'unauthorized' })
      .mockResolvedValueOnce(undefined);

    await coordinator.start(auth);

    expect(push.register).toHaveBeenNthCalledWith(
      1,
      'access-1',
      expect.anything()
    );
    expect(push.register).toHaveBeenNthCalledWith(
      2,
      'access-2',
      expect.anything()
    );
    expect(coordinator.getSnapshot().status).toBe('enabled');
  });

  it('registers token rollover and revokes before teardown', async () => {
    const { coordinator, native, push, emitToken } = setup();
    native.getPermission.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    await coordinator.start(auth);

    emitToken('ExponentPushToken[next]');
    await coordinator.whenIdle();
    await coordinator.revoke('access-1');

    expect(push.register).toHaveBeenLastCalledWith(
      'access-1',
      expect.objectContaining({ expoPushToken: 'ExponentPushToken[next]' })
    );
    expect(push.revoke).toHaveBeenCalledWith(
      'access-1',
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('surfaces unavailable and retry-needed states without throwing', async () => {
    const unavailable = setup();
    unavailable.native.isAvailable = () => false;
    await expect(unavailable.coordinator.start(auth)).resolves.toBeUndefined();
    expect(unavailable.coordinator.getSnapshot().status).toBe('unavailable');

    const offline = setup();
    offline.native.getPermission.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    offline.native.getExpoPushToken.mockRejectedValue(
      new Error('offline secret')
    );
    await expect(offline.coordinator.start(auth)).resolves.toBeUndefined();
    expect(offline.coordinator.getSnapshot().status).toBe('retry_needed');
  });

  it('removes native listeners and ignores stale work after stop', async () => {
    const { coordinator, native, removeTokenListener } = setup();
    let release!: (value: { granted: boolean; canAskAgain: boolean }) => void;
    native.getPermission.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const starting = coordinator.start(auth);
    coordinator.stop();
    release({ granted: true, canAskAgain: true });
    await starting;

    expect(removeTokenListener).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot().status).toBe('checking');
  });
});
