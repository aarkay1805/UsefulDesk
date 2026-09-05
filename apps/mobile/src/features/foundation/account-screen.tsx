import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, ScreenSafeAreaView, Text } from '../../ui';
import { useReadyAuth } from '../auth/auth-context';
import { BranchChoices } from '../auth/screens/select-branch-screen';
import { useNotifications } from '../notifications/notifications-context';

export function AccountScreen() {
  const router = useRouter();
  const auth = useReadyAuth();
  const notifications = useNotifications();
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);

  const { state } = auth;
  const handleSignOut = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    await auth.signOut();
  };
  const handleSelectBranch = async (accountId: string) => {
    await auth.selectBranch(accountId);
    router.dismissAll();
  };

  return (
    <ScreenSafeAreaView className="bg-background" edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View className="gap-1">
          <Text className="text-foreground text-base font-semibold">
            {state.profile.full_name || state.profile.email}
          </Text>
          <Text className="text-muted text-sm leading-5">
            {state.profile.email}
          </Text>
        </View>

        <View className="gap-3">
          <View className="gap-1">
            <Text
              accessibilityRole="header"
              className="text-foreground text-lg font-semibold"
            >
              Branch
            </Text>
            <Text className="text-muted text-sm leading-5">
              Switch the branch used for this native workspace.
            </Text>
          </View>
          <BranchChoices
            branches={state.branches}
            currentAccountId={state.branch.account_id}
            key={state.branch.account_id}
            onSelect={handleSelectBranch}
          />
        </View>

        <View className="gap-3">
          <View className="gap-1">
            <Text
              accessibilityRole="header"
              className="text-foreground text-lg font-semibold"
            >
              Notifications
            </Text>
            <Text className="text-muted text-sm leading-5">
              {notifications.message}
            </Text>
          </View>
          {notifications.recoveryAction === 'request' ||
          notifications.recoveryAction === 'retry' ? (
            <Button
              accessibilityLabel={
                notifications.status === 'retry_needed'
                  ? 'Try notification setup again'
                  : 'Enable notifications'
              }
              onPress={() => void notifications.requestPermission()}
              variant="secondary"
            >
              {notifications.status === 'retry_needed'
                ? 'Try notification setup again'
                : 'Enable notifications'}
            </Button>
          ) : null}
          {notifications.recoveryAction === 'settings' ? (
            <Button
              accessibilityLabel="Open settings"
              onPress={() => void notifications.openSettings()}
              variant="secondary"
            >
              Open settings
            </Button>
          ) : null}
        </View>

        <View className="gap-3">
          <View className="gap-1">
            <Text
              accessibilityRole="header"
              className="text-foreground text-lg font-semibold"
            >
              Diagnostics
            </Text>
            <Text className="text-muted text-sm leading-5">
              Check which environment and backend this build points at.
            </Text>
          </View>
          <Button
            accessibilityLabel="Open diagnostics"
            onPress={() => router.push('/(app)/diagnostics')}
            variant="secondary"
          >
            Open diagnostics
          </Button>
        </View>

        <Button
          accessibilityLabel="Sign out"
          loading={signingOut}
          onPress={() => void handleSignOut()}
          variant="danger-soft"
        >
          Sign out
        </Button>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 32,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
});
