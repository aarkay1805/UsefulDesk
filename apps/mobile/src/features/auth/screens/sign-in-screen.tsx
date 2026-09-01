import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, ScreenSafeAreaView, TextField } from '../../../ui';
import { useAuth } from '../auth-context';

type PendingAction = 'password' | 'google' | 'cleanup' | null;

export function SignInScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const authError =
    auth.state.status === 'signed_out' || auth.state.status === 'cleanup_failed'
      ? (auth.state.error ?? null)
      : null;
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

  const retrySecureSignOut = async () => {
    if (!begin('cleanup')) return;
    try {
      await auth.signOut();
    } catch {
      setActionError(
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.'
      );
    } finally {
      finish();
    }
  };

  if (auth.state.status === 'signing_out') {
    return (
      <ScreenSafeAreaView className="bg-background" edges={['top', 'bottom']}>
        <View className="flex-1 justify-center gap-3 px-6 py-8">
          <Text
            accessibilityRole="header"
            className="text-foreground text-3xl font-bold"
          >
            UsefulDesk Agent
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            className="text-muted text-base leading-6"
          >
            Signing out securely…
          </Text>
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (auth.state.status === 'cleanup_failed') {
    return (
      <ScreenSafeAreaView className="bg-background" edges={['top', 'bottom']}>
        <View className="flex-1 justify-center gap-5 px-6 py-8">
          <View className="gap-2">
            <Text
              accessibilityRole="header"
              className="text-foreground text-3xl font-bold"
            >
              Secure sign-out needs attention
            </Text>
            <Text className="text-muted text-base leading-6">
              Finish clearing this device before signing in again.
            </Text>
          </View>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="text-danger text-sm leading-5"
          >
            {error}
          </Text>
          <Button
            accessibilityLabel="Retry secure sign-out"
            loading={pendingAction === 'cleanup'}
            onPress={() => void retrySecureSignOut()}
          >
            Retry secure sign-out
          </Button>
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView className="bg-background" edges={['top', 'bottom']}>
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
              returnKeyType="done"
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
              secureTextEntry={!passwordVisible}
              textContentType="password"
              value={password}
            />
            <Button
              accessibilityLabel={
                passwordVisible ? 'Hide password' : 'Show password'
              }
              onPress={() => setPasswordVisible((visible) => !visible)}
              variant="ghost"
            >
              {passwordVisible ? 'Hide password' : 'Show password'}
            </Button>

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
    </ScreenSafeAreaView>
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
