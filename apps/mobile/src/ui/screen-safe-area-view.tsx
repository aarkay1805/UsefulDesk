import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView as NativeSafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

const UniwindSafeAreaView = withUniwind(NativeSafeAreaView);

type ScreenSafeAreaViewProps = ComponentProps<typeof NativeSafeAreaView> & {
  className?: string;
};

export function ScreenSafeAreaView({
  style,
  ...props
}: ScreenSafeAreaViewProps) {
  return <UniwindSafeAreaView {...props} style={[styles.root, style]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
