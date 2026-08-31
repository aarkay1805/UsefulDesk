import '../global.css';

import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { MobileAppProviders } from '../src/core/mobile-app-providers';
import { AuthProvider } from '../src/features/auth/auth-context';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return (
    <MobileAppProviders>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </MobileAppProviders>
  );
}
