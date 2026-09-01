import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenSafeAreaView } from '../../ui';
import { useReadyAuth } from '../auth/auth-context';
import { BranchChoices } from '../auth/screens/select-branch-screen';

export function AccountScreen() {
  const router = useRouter();
  const auth = useReadyAuth();
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
    router.replace('/(app)');
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
