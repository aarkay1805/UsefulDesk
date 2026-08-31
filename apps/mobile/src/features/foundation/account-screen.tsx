import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../ui';
import { useAuth } from '../auth/auth-context';
import { BranchChoices } from '../auth/screens/select-branch-screen';

export function AccountScreen() {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  if (auth.state.status !== 'ready') return null;

  const { state } = auth;
  const handleSignOut = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    await auth.signOut();
  };

  return (
    <SafeAreaView className="bg-background flex-1" edges={['bottom']}>
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
            onSelect={auth.selectBranch}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 32,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
});
