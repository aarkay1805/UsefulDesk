import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, TextField } from '../../../ui';
import { useAuth } from '../auth-context';

type PendingAction = 'password' | 'google' | null;

export function SignInScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const authError =
    auth.state.status === 'signed_out' ? (auth.state.error ?? null) : null;
  const error = actionError ?? authError;

  const begin = (action: Exclude<PendingAction, null>): boolean => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(action);
    setActionError(null);
    return true;
  };

  const finish = () => {
    pendingRef.current = false;
    setPendingAction(null);
  };

  const submitPassword = async () => {
    if (!begin('password')) return;
    try {
      const result = await auth.signInWithPassword(email, password);
      if (result.status === 'error') {
        setActionError(result.message);
        finish();
      }
    } catch {
      setActionError('Could not sign in. Please try again.');
      finish();
    }
  };

  const submitGoogle = async () => {
    if (!begin('google')) return;
    try {
      const result = await auth.signInWithGoogle();
      if (result.status === 'error') setActionError(result.message);
      if (result.status !== 'success') finish();
    } catch {
      setActionError('Could not complete Google sign-in. Please try again.');
      finish();
    }
  };

  return (
    <SafeAreaView className="bg-background flex-1" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <Text
              accessibilityRole="header"
              className="text-foreground text-3xl font-bold"
            >
              UsefulDesk Agent
            </Text>
            <Text className="text-muted text-base leading-6">
              Sign in with your existing UsefulDesk account.
            </Text>
          </View>

          <View className="gap-4">
            <TextField
              label="Email"
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              returnKeyType="next"
              textContentType="emailAddress"
              value={email}
            />
            <TextField
              label="Password"
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete="current-password"
              onChangeText={setPassword}
              onSubmitEditing={() => void submitPassword()}
              returnKeyType="done"
              secureTextEntry
              textContentType="password"
              value={password}
            />

            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                className="text-danger text-sm leading-5"
              >
                {error}
              </Text>
            ) : null}

            <Button
              accessibilityLabel="Sign in"
              disabled={pendingAction !== null}
              loading={pendingAction === 'password'}
              onPress={() => void submitPassword()}
            >
              Sign in
            </Button>

            <View
              className="flex-row items-center gap-3"
              accessibilityElementsHidden
            >
              <View className="bg-separator h-px flex-1" />
              <Text className="text-muted text-sm">or</Text>
              <View className="bg-separator h-px flex-1" />
            </View>

            <Button
              accessibilityLabel="Continue with Google"
              disabled={pendingAction !== null}
              loading={pendingAction === 'google'}
              onPress={() => void submitGoogle()}
              variant="outline"
            >
              Continue with Google
            </Button>
          </View>

          <Text className="text-muted text-sm leading-5">
            Need access? Ask your UsefulDesk owner or administrator to add your
            existing email address.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
});
