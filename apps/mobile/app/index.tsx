import { Redirect } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { hideSplashAfterAuthResolution } from '../src/core/splash-control';
import { useAuth } from '../src/features/auth/auth-context';
import { entryRouteForAuthState } from '../src/features/auth/entry-route';

export default function IndexRoute() {
  const { state } = useAuth();
  const href = entryRouteForAuthState(state);

  useEffect(() => {
    if (href) void hideSplashAfterAuthResolution(SplashScreen);
  }, [href]);

  return href ? <Redirect href={href} /> : null;
}
