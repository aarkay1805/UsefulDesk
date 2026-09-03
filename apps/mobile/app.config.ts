import type { ExpoConfig } from 'expo/config';

type UsefulDeskExpoConfig = ExpoConfig & { newArchEnabled: boolean };

const config: UsefulDeskExpoConfig = {
  name: 'UsefulDesk Agent',
  owner: 'aarkay180591',
  slug: 'usefuldesk-agent',
  scheme: 'usefuldesk-agent',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { bundleIdentifier: 'com.usefulmade.usefuldesk.agent' },
  android: {
    package: 'com.usefulmade.usefuldesk.agent',
    googleServicesFile: './google-services.json',
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    'expo-secure-store',
    'expo-font',
    'expo-image',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow UsefulDesk Agent to choose photos and videos to send in Inbox conversations.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    'expo-document-picker',
  ],
  extra: {
    eas: {
      projectId: '705a328d-019b-41b5-9887-a637931a4bd5',
    },
  },
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
