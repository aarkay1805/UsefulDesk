import { createNotificationPermissionPrompt } from './notification-permission-prompt';

describe('notification permission explanation', () => {
  it('uses the system alert with exact defer and continue actions', () => {
    const alert = jest.fn();
    const onNotNow = jest.fn();
    const onContinue = jest.fn();

    createNotificationPermissionPrompt(alert).show({ onNotNow, onContinue });

    expect(alert).toHaveBeenCalledWith(
      'Never miss a customer message',
      expect.stringContaining('UsefulDesk'),
      [
        expect.objectContaining({ text: 'Not now', onPress: onNotNow }),
        expect.objectContaining({ text: 'Continue', onPress: onContinue }),
      ]
    );
  });
});
