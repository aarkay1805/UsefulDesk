import { createNativeNotifications } from './notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addPushTokenListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
}));

describe('native notifications adapter', () => {
  it('creates the Android channel before requesting permission', async () => {
    const order: string[] = [];
    const notifications = {
      setNotificationChannelAsync: jest.fn(async () => {
        order.push('channel');
        return null;
      }),
      requestPermissionsAsync: jest.fn(async () => {
        order.push('permission');
        return { granted: true, canAskAgain: true, status: 'granted' };
      }),
      setNotificationHandler: jest.fn(),
      getPermissionsAsync: jest.fn(),
      getExpoPushTokenAsync: jest.fn(),
      addPushTokenListener: jest.fn(),
      addNotificationResponseReceivedListener: jest.fn(),
      getLastNotificationResponseAsync: jest.fn(),
    };
    const native = createNativeNotifications({
      notifications,
      platform: 'android',
      isDevice: true,
      projectId: 'project-id',
      openSettings: jest.fn(),
    });

    await native.requestPermission();

    expect(order).toEqual(['channel', 'permission']);
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'messages',
      expect.objectContaining({
        name: 'Messages',
        importance: expect.any(Number),
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      })
    );
  });

  it('configures foreground banner, list, and sound presentation', async () => {
    const notifications = {
      setNotificationChannelAsync: jest.fn(),
      requestPermissionsAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      getPermissionsAsync: jest.fn(),
      getExpoPushTokenAsync: jest.fn(),
      addPushTokenListener: jest.fn(),
      addNotificationResponseReceivedListener: jest.fn(),
      getLastNotificationResponseAsync: jest.fn(),
    };
    createNativeNotifications({
      notifications,
      platform: 'ios',
      isDevice: true,
      projectId: 'project-id',
      openSettings: jest.fn(),
    }).configureForegroundPresentation();

    const handler = notifications.setNotificationHandler.mock.calls[0][0];
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('uses the EAS project id and rejects simulator token acquisition', async () => {
    const notifications = {
      setNotificationChannelAsync: jest.fn(),
      requestPermissionsAsync: jest.fn(),
      setNotificationHandler: jest.fn(),
      getPermissionsAsync: jest.fn(),
      getExpoPushTokenAsync: jest
        .fn()
        .mockResolvedValue({ data: 'ExponentPushToken[test]' }),
      addPushTokenListener: jest.fn(),
      addNotificationResponseReceivedListener: jest.fn(),
      getLastNotificationResponseAsync: jest.fn(),
    };
    const device = createNativeNotifications({
      notifications,
      platform: 'ios',
      isDevice: true,
      projectId: 'eas-project',
      openSettings: jest.fn(),
    });
    const simulator = createNativeNotifications({
      notifications,
      platform: 'ios',
      isDevice: false,
      projectId: 'eas-project',
      openSettings: jest.fn(),
    });

    await expect(device.getExpoPushToken()).resolves.toBe(
      'ExponentPushToken[test]'
    );
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'eas-project',
    });
    await expect(simulator.getExpoPushToken()).rejects.toThrow('unavailable');
  });
});
