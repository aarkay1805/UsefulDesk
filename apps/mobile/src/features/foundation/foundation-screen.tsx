import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mobileEnvironment } from '../../core/env';
import { Button } from '../../ui';
import { useReadyAuth } from '../auth/auth-context';

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());

export function FoundationScreen() {
  const router = useRouter();
  const { state } = useReadyAuth();

  const details = [
    ['Branch', state.branch.account_name],
    ['Organization', state.branch.organization_name],
    ['Role', titleCase(state.branch.role)],
    ['Readiness', titleCase(state.branch.readiness_state)],
    ['Environment', titleCase(mobileEnvironment.appEnvironment)],
  ] as const;

  return (
    <SafeAreaView className="bg-background flex-1" edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View className="gap-2">
          <Text
            accessibilityRole="header"
            className="text-foreground text-2xl font-bold"
          >
            {state.branch.account_name}
          </Text>
          <Text className="text-muted text-base leading-6">
            {state.branch.organization_name}
          </Text>
        </View>

        <View className="bg-success-soft gap-1 rounded-xl p-4">
          <Text
            accessibilityLiveRegion="polite"
            className="text-success-soft-foreground text-base font-semibold"
          >
            Native connection ready
          </Text>
          <Text className="text-success-soft-foreground text-sm leading-5">
            Your session and branch-scoped data connection are ready on this
            device.
          </Text>
        </View>

        <View className="border-border bg-surface rounded-xl border px-4">
          {details.map(([label, value], index) => (
            <View
              className={`min-h-14 flex-row items-center justify-between gap-4 py-3 ${
                index === details.length - 1 ? '' : 'border-separator border-b'
              }`}
              key={label}
            >
              <Text className="text-muted text-sm">{label}</Text>
              <Text className="text-surface-foreground shrink text-right text-sm font-medium">
                {value}
              </Text>
            </View>
          ))}
        </View>

        <Button
          accessibilityLabel="Open Account"
          onPress={() => router.push('/(app)/account')}
          variant="outline"
        >
          Account
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
});
