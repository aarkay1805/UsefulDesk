import { Stack } from 'expo-router';

import { useAuth } from '../../src/features/auth/auth-context';

export default function AuthLayout() {
  const { state } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected
        guard={
          state.status === 'signed_out' ||
          state.status === 'signing_out' ||
          state.status === 'cleanup_failed'
        }
      >
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected
        guard={state.status === 'choose_branch' || state.status === 'blocked'}
      >
        <Stack.Screen name="select-branch" />
      </Stack.Protected>
    </Stack>
  );
}
