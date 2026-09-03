import '../global.css';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';

import { MobileAppProviders } from '../src/core/mobile-app-providers';
import { preventSplashAutoHide } from '../src/core/splash-control';
import { AuthProvider, useAuth } from '../src/features/auth/auth-context';
import { NotificationRouter } from '../src/features/notifications/notification-router';
import { NotificationsProvider } from '../src/features/notifications/notifications-context';

WebBrowser.maybeCompleteAuthSession();
void preventSplashAutoHide(SplashScreen);

export default function RootLayout() {
  return (
    <MobileAppProviders>
      <AuthProvider>
        <NotificationsProvider>
          <NotificationRouter />
          <RootNavigator />
        </NotificationsProvider>
      </AuthProvider>
    </MobileAppProviders>
  );
}

function RootNavigator() {
  const { state } = useAuth();
  const resolved = state.status !== 'booting';

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={resolved && state.status !== 'ready'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'ready'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
