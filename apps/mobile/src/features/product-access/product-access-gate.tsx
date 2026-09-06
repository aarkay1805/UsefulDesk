import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AppState, Linking, ScrollView, View } from 'react-native';

import { accountFormatters } from '../../core/account-formatters';
import { Button, Notice, ScreenSafeAreaView, Text } from '../../ui';
import { useReadyAuth, type ReadyAuthContextValue } from '../auth/auth-context';
import { BranchChoices } from '../auth/screens/select-branch-screen';
import {
  accessDeadline,
  canMountProduct,
  loadProductAccess,
  requestProductSupport,
  type ProductAccessSnapshot,
} from './product-access-service';

export function ProductAccessGate({ children }: PropsWithChildren) {
  const auth = useReadyAuth();
  return (
    <AccountAccessGate
      key={`${auth.state.profile.id}:${auth.state.branch.account_id}`}
      auth={auth}
    >
      {children}
    </AccountAccessGate>
  );
}

function AccountAccessGate({
  auth,
  children,
}: PropsWithChildren<{ auth: ReadyAuthContextValue }>) {
  const { state } = auth;
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{
    request: number;
    snapshot: ProductAccessSnapshot | null;
    failed: boolean;
  } | null>(null);
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(() => setRequest((value) => value + 1), []);
  const snapshot = result?.request === request ? result.snapshot : null;
  const loading = result?.request !== request;
  const deadline = accessDeadline(snapshot);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadProductAccess(
          state.branch.account_id,
          state.branch.organization_id
        );
        if (!cancelled) {
          setNow(Date.now());
          setResult({ request, snapshot: next, failed: false });
        }
      } catch {
        if (!cancelled) setResult({ request, snapshot: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, state.branch.account_id, state.branch.organization_id]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setNow(Date.now());
        refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    // The deadline timer removes operational children before waiting on a network response.
    if (deadline === null || deadline <= Date.now()) return;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
        refresh();
      },
      Math.min(deadline - Date.now(), 2_147_483_647)
    );
    return () => clearTimeout(timer);
  }, [deadline, refresh]);

  useEffect(() => {
    if (snapshot?.status !== 'trial') return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [snapshot?.status]);

  if (canMountProduct(snapshot, now)) {
    const end = snapshot?.access.trial_ends_at;
    const days = end
      ? Math.max(0, Math.ceil((Date.parse(end) - now) / 86_400_000))
      : 0;
    return (
      <View className="flex-1">
        {snapshot?.status === 'trial' && end ? (
          <ScreenSafeAreaView edges={['top']} style={{ flex: 0 }}>
            <Notice
              className="mx-5 my-2"
              emphasis="outline"
              title="UsefulDesk trial"
            >
              {`${accountFormatters(state.account).number(days)} ${days === 1 ? 'day' : 'days'} left · Ends ${accountFormatters(state.account).dateTime(end)}`}
            </Notice>
          </ScreenSafeAreaView>
        ) : null}
        {children}
      </View>
    );
  }

  return (
    <AccessRecovery
      auth={auth}
      snapshot={snapshot}
      loading={loading}
      failed={result?.failed ?? false}
      onRetry={refresh}
    />
  );
}

function AccessRecovery({
  auth,
  snapshot,
  loading,
  failed,
  onRetry,
}: {
  auth: ReadyAuthContextValue;
  snapshot: ProductAccessSnapshot | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function contactSupport() {
    setPending('support');
    setMessage(null);
    try {
      const phone = snapshot?.support_whatsapp?.replace(/\D/g, '');
      const email = snapshot?.support_email;
      const url = phone
        ? `https://wa.me/${phone}`
        : email
          ? `mailto:${encodeURIComponent(email)}`
          : null;
      if (url) {
        try {
          await Linking.openURL(url);
          return;
        } catch {
          /* Built-in recovery remains available. */
        }
      }
      await requestProductSupport(auth.state.branch.account_id);
      setMessage(
        'Support request received. Our team will contact your organization.'
      );
    } catch {
      setMessage('Could not send your support request. Please try again.');
    } finally {
      setPending(null);
    }
  }
  async function signOut() {
    setPending('signout');
    try {
      await auth.signOut();
    } catch {
      setMessage('Could not sign out. Please try again.');
    } finally {
      setPending(null);
    }
  }
  const reason = loading
    ? 'Checking your organization’s access…'
    : failed
      ? 'Could not verify access. Check your connection and try again.'
      : snapshot?.status === 'suspended'
        ? 'Your organization’s access is suspended. Contact support to restore access.'
        : snapshot?.status === 'pending'
          ? 'Your organization’s access is not active yet. Contact support to get started.'
          : 'Your organization’s UsefulDesk access has ended. Contact support to continue.';
  return (
    <ScreenSafeAreaView className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
        <Text
          accessibilityRole="header"
          className="text-foreground text-xl font-semibold"
        >
          UsefulDesk access
        </Text>
        <Text className="text-muted text-base">
          {auth.state.branch.organization_name}
        </Text>
        <Notice
          title={loading ? 'Checking access' : 'Contact support'}
          loading={loading}
          emphasis="outline"
          action={
            <Button
              loading={pending === 'support'}
              disabled={pending !== null}
              onPress={() => void contactSupport()}
            >
              Contact support
            </Button>
          }
        >
          {reason}
        </Notice>
        {message ? <Notice emphasis="outline">{message}</Notice> : null}
        <Button variant="secondary" loading={loading} onPress={onRetry}>
          Check access again
        </Button>
        <View className="gap-3">
          <Text
            accessibilityRole="header"
            className="text-foreground text-lg font-semibold"
          >
            Switch branch or organization
          </Text>
          <BranchChoices
            branches={auth.state.branches}
            currentAccountId={auth.state.branch.account_id}
            onSelect={auth.selectBranch}
          />
        </View>
        <Button
          variant="danger-soft"
          loading={pending === 'signout'}
          disabled={pending !== null}
          onPress={() => void signOut()}
        >
          Sign out
        </Button>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}
