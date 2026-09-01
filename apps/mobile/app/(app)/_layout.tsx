import { Stack } from 'expo-router';

import { useAuth } from '../../src/features/auth/auth-context';

export default function AppLayout() {
  const { state } = useAuth();

  return (
    <Stack>
      <Stack.Protected guard={state.status === 'ready'}>
        <Stack.Screen name="index" options={{ title: 'UsefulDesk Agent' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack.Protected>
    </Stack>
  );
}
