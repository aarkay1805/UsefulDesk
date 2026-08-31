import type { ExpoConfig } from 'expo/config';

type UsefulDeskExpoConfig = ExpoConfig & { newArchEnabled: boolean };

const config: UsefulDeskExpoConfig = {
  name: 'UsefulDesk Agent',
  slug: 'usefuldesk-agent',
  scheme: 'usefuldesk-agent',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { bundleIdentifier: 'com.usefulmade.usefuldesk.agent' },
  android: {
    package: 'com.usefulmade.usefuldesk.agent',
    predictiveBackGestureEnabled: true,
  },
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
