import { Stack } from 'expo-router';

import { useAuth } from '../../src/features/auth/auth-context';
import { InboxRealtimeProvider } from '../../src/features/inbox/inbox-realtime-provider';

function ProtectedAppStack({ guard }: { guard: boolean }) {
  return (
    <Stack>
      <Stack.Protected guard={guard}>
        <Stack.Screen name="index" options={{ title: 'Inbox' }} />
        <Stack.Screen name="conversation/[conversationId]" />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function AppLayout() {
  const { state } = useAuth();

  if (state.status !== 'ready') return <ProtectedAppStack guard={false} />;

  return (
    <InboxRealtimeProvider
      key={state.branch.account_id}
      accountId={state.branch.account_id}
    >
      <ProtectedAppStack guard />
    </InboxRealtimeProvider>
  );
}
