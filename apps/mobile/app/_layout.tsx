import '../global.css';

import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { MobileAppProviders } from '../src/core/mobile-app-providers';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return (
    <MobileAppProviders>
      <Stack screenOptions={{ headerShown: false }} />
    </MobileAppProviders>
  );
}
