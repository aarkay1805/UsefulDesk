import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenSafeAreaView } from '../../../ui';
import { useAuth } from '../auth-context';
import { branchBlockMessage, type BranchAccount } from '../branch-types';

interface BranchChoicesProps {
  branches: BranchAccount[];
  currentAccountId?: string;
  onSelect(accountId: string): Promise<void>;
}

export function BranchChoices({
  branches,
  currentAccountId,
  onSelect,
}: BranchChoicesProps) {
  const available = branches.filter(
    (branch) => branch.branch_status !== 'archived'
  );
  const [pendingBranchId, setPendingBranchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const choose = async (accountId: string) => {
    if (selectingRef.current || accountId === currentAccountId) return;
    selectingRef.current = true;
    setPendingBranchId(accountId);
    setError(null);
    try {
      await onSelect(accountId);
    } catch {
      if (mountedRef.current) {
        setError(
          'Could not open this branch. Check your connection and try again.'
        );
      }
    } finally {
      selectingRef.current = false;
      if (mountedRef.current) setPendingBranchId(null);
    }
  };

  return (
    <View className="gap-3">
      {available.map((branch) => {
        const isCurrent = branch.account_id === currentAccountId;
        return (
          <View
            className="border-border bg-surface gap-4 rounded-xl border p-4"
            key={branch.account_id}
          >
            <View className="gap-1">
              <Text className="text-surface-foreground text-base font-semibold">
                {branch.account_name}
              </Text>
              <Text className="text-muted text-sm leading-5">
                {branch.organization_name}
              </Text>
            </View>
            <Button
              accessibilityLabel={
                isCurrent
                  ? `${branch.account_name} is the current branch`
                  : `Choose ${branch.account_name} branch`
              }
              disabled={isCurrent || pendingBranchId !== null}
              loading={pendingBranchId === branch.account_id}
              onPress={() => void choose(branch.account_id)}
              variant={isCurrent ? 'secondary' : 'outline'}
            >
              {isCurrent ? 'Current branch' : 'Choose branch'}
            </Button>
          </View>
        );
      })}

      {available.length === 0 ? (
        <Text className="text-muted text-sm leading-5">
          No available branches were found for this account.
        </Text>
      ) : null}

      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="text-danger text-sm leading-5"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function SelectBranchScreen() {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);
  const state = auth.state;
  const branches =
    state.status === 'choose_branch' || state.status === 'blocked'
      ? state.branches
      : [];
  const reason =
    state.status === 'blocked' ? branchBlockMessage(state.reason) : null;
  const hasAvailableBranch = branches.some(
    (branch) => branch.branch_status !== 'archived'
  );
  const needsSignOutRecovery =
    !hasAvailableBranch ||
    (state.status === 'blocked' && state.reason === 'profile_unavailable');

  const retryFromSignIn = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    await auth.signOut();
  };

  return (
    <ScreenSafeAreaView className="bg-background" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View className="gap-2">
          <Text
            accessibilityRole="header"
            className="text-foreground text-3xl font-bold"
          >
            Choose a branch
          </Text>
          <Text className="text-muted text-base leading-6">
            Your work and permissions follow the branch you open.
          </Text>
        </View>

        {reason ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="bg-warning-soft gap-1 rounded-xl p-4"
          >
            <Text className="text-warning-soft-foreground text-sm font-semibold">
              Branch access needs attention
            </Text>
            <Text className="text-warning-soft-foreground text-sm leading-5">
              {reason}
            </Text>
          </View>
        ) : null}

        <BranchChoices branches={branches} onSelect={auth.selectBranch} />

        {needsSignOutRecovery ? (
          <Button
            accessibilityLabel="Sign out and try again"
            loading={signingOut}
            onPress={() => void retryFromSignIn()}
            variant="outline"
          >
            Sign out and try again
          </Button>
        ) : null}
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: 24,
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
});
