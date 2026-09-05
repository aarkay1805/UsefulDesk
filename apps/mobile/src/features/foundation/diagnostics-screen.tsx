import * as Application from 'expo-application';
import { ScrollView, StyleSheet, View } from 'react-native';

import { mobileEnvironment, pushEnvironment } from '../../core/env';
import { ScreenSafeAreaView } from '../../ui/screen-safe-area-view';
import { Text } from '../../ui/text';
import { useReadyAuth } from '../auth/auth-context';

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());

/**
 * Host and port only. `readMobileEnvironment` has already parsed both URLs and
 * rejected any carrying credentials, a query, or a fragment, so this cannot
 * throw and cannot print a secret that arrived in the URL.
 */
const hostOf = (url: string) => new URL(url).host;

const unknown = '—';

interface DetailGroup {
  title: string;
  description: string;
  rows: readonly (readonly [string, string])[];
}

/**
 * The one in-app answer to "what is this build actually pointing at?".
 *
 * A published binary carries its backend in `EXPO_PUBLIC_*` values baked in at
 * build time, so until this screen existed the only way to tell a preview build
 * from a production one — or to catch a store build shipped against the staging
 * API — was to unpack the bundle. Support asks the same question from the other
 * end: which branch, which role, which push channel.
 *
 * **Never render `mobileEnvironment.supabaseAnonKey` or any other credential
 * here.** The screen is reachable by every signed-in user on their own device
 * and is the natural place for someone to screenshot when reporting a problem.
 * Identifying a backend needs its host; it never needs its key.
 */
export function DiagnosticsScreen() {
  const { state } = useReadyAuth();

  const groups: readonly DetailGroup[] = [
    {
      title: 'Build',
      description:
        'Baked in when this binary was built, and fixed until the next one.',
      rows: [
        ['Environment', titleCase(mobileEnvironment.appEnvironment)],
        [
          'Push channel',
          titleCase(pushEnvironment(mobileEnvironment.appEnvironment)),
        ],
        ['App version', Application.nativeApplicationVersion ?? unknown],
        ['Build number', Application.nativeBuildVersion ?? unknown],
        ['API host', hostOf(mobileEnvironment.apiBaseUrl)],
        ['Supabase host', hostOf(mobileEnvironment.supabaseUrl)],
      ],
    },
    {
      title: 'Session',
      description: 'The workspace this device is signed in to right now.',
      rows: [
        ['Branch', state.branch.account_name],
        ['Organization', state.branch.organization_name],
        ['Role', titleCase(state.branch.role)],
        ['Readiness', titleCase(state.branch.readiness_state)],
      ],
    },
  ];

  return (
    <ScreenSafeAreaView className="bg-background" edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {groups.map((group) => (
          <View className="gap-3" key={group.title}>
            <View className="gap-1">
              <Text
                accessibilityRole="header"
                className="text-foreground text-lg font-semibold"
              >
                {group.title}
              </Text>
              <Text className="text-muted text-sm leading-5">
                {group.description}
              </Text>
            </View>

            <View className="border-border bg-surface rounded-xl border px-4">
              {group.rows.map(([label, value], index) => (
                <View
                  className={`min-h-14 flex-row items-center justify-between gap-4 py-3 ${
                    index === group.rows.length - 1
                      ? ''
                      : 'border-separator border-b'
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
          </View>
        ))}
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
