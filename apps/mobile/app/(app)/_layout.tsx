import { Stack } from 'expo-router';

import { useAuth } from '../../src/features/auth/auth-context';
import { InboxRealtimeProvider } from '../../src/features/inbox/inbox-realtime-provider';

export default function AppLayout() {
  const { state } = useAuth();

  if (state.status !== 'ready') {
    return (
      <Stack>
        <Stack.Protected guard={false}>
          <Stack.Screen name="index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
        </Stack.Protected>
      </Stack>
    );
  }

  return (
    <InboxRealtimeProvider
      key={state.branch.account_id}
      accountId={state.branch.account_id}
    >
      <Stack>
        <Stack.Protected guard>
          <Stack.Screen name="index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
        </Stack.Protected>
      </Stack>
    </InboxRealtimeProvider>
  );
}
