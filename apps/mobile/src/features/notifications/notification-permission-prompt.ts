import { Alert } from 'react-native';

interface PromptActions {
  onNotNow(): void;
  onContinue(): void;
}

type SystemAlert = (
  title: string,
  message: string,
  buttons: { text: string; style?: 'cancel'; onPress(): void }[]
) => void;

export interface NotificationPermissionPrompt {
  show(actions: PromptActions): void;
}

export function createNotificationPermissionPrompt(
  alert: SystemAlert
): NotificationPermissionPrompt {
  return {
    show: ({ onNotNow, onContinue }) =>
      alert(
        'Never miss a customer message',
        'UsefulDesk can notify you when a customer sends a new WhatsApp message, even when the app is closed.',
        [
          { text: 'Not now', style: 'cancel', onPress: onNotNow },
          { text: 'Continue', onPress: onContinue },
        ]
      ),
  };
}

export const notificationPermissionPrompt = createNotificationPermissionPrompt(
  Alert.alert
);
