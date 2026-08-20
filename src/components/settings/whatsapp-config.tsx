'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canEditSettings } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { WhatsAppMark } from '@/components/brand/provider-mark';
import { Button, buttonVariants } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { WhatsAppEmbeddedSignup } from './whatsapp-embedded-signup';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

// Embedded Signup is the default connect path when the platform's
// Meta app id + signup configuration id are exposed to the client;
// without them the manual credential form is the only path and it
// renders expanded instead of tucked behind "Advanced".
const EMBEDDED_SIGNUP_AVAILABLE = Boolean(
  process.env.NEXT_PUBLIC_META_APP_ID &&
  process.env.NEXT_PUBLIC_META_ES_CONFIG_ID
);

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

const REGISTRATION_CHECK_LABELS: Record<string, string> = {
  config_exists: 'Configuration saved',
  token_decryptable: 'Access token readable',
  phone_metadata_ok: 'Phone number reachable',
  waba_subscribed_to_app: 'Webhook subscription active',
  locally_marked_registered: 'Number registered for messaging',
};

export function WhatsAppConfig() {
  const supabase = createClient();
  // After multi-user, whatsapp_config is one-row-per-account, not
  // one-row-per-user. We pull `accountId` straight off the auth
  // context and key every read off it — so a teammate who just
  // joined an account sees the inviter's saved config without
  // having to re-enter anything.
  const {
    user,
    accountId,
    accountRole,
    loading: authLoading,
    profileLoading,
  } = useAuth();
  const { fmt } = useLocale();
  const userId = user?.id;
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  // Guards against re-hydrating the form when the load effect below
  // re-runs for reasons unrelated to actually switching accounts —
  // e.g. Supabase's onAuthStateChange fires a token refresh (new
  // `user` object, profileLoading flips true/false) when the browser
  // tab regains focus. Without this, that churn calls fetchConfig()
  // again and overwrites whatever the user typed but hadn't saved yet.
  const loadedAccountIdRef = useRef<string | null>(null);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    error?: string;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(
    async (acctId: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        // Load form values from Supabase (shows what's in DB).
        // Switched from `user_id` (which would only match the row's
        // original author) to `account_id` so every member of the
        // account sees the same saved configuration. UNIQUE(account_id)
        // on the table guarantees the .maybeSingle() return type
        // remains accurate.
        const { data, error } = await supabase
          .from('whatsapp_config')
          .select('*')
          .eq('account_id', acctId)
          .maybeSingle();

        if (error) {
          console.error('Failed to load config row:', error);
          throw error;
        }

        if (data) {
          setConfig(data);
          setPhoneNumberId(data.phone_number_id || '');
          setWabaId(data.waba_id || '');
          setAccessToken(MASKED_TOKEN);
          setVerifyToken('');
          setPin('');
          setTokenEdited(false);
        } else {
          setConfig(null);
          setPhoneNumberId('');
          setWabaId('');
          setAccessToken('');
          setVerifyToken('');
          setPin('');
          setTokenEdited(false);
        }
        // Clear any stale probe result when reloading the row.
        setRegistrationProbe(null);

        // Then verify health via the API (decrypts token + pings Meta)
        if (data && canEdit) {
          try {
            const res = await fetch('/api/whatsapp/config', { method: 'GET' });
            const payload = await res.json();

            if (!res.ok) {
              throw new Error(
                payload.error || 'Could not check the saved connection'
              );
            }

            if (payload.connected) {
              setConnectionStatus('connected');
              setResetReason(null);
              setStatusMessage('');
            } else {
              setConnectionStatus('disconnected');
              setResetReason(
                payload.needs_reset
                  ? 'token_corrupted'
                  : payload.reason === 'meta_api_error'
                    ? 'meta_api_error'
                    : null
              );
              setStatusMessage(payload.message || '');
            }
          } catch (err) {
            console.error('Health check failed:', err);
            setConnectionStatus('disconnected');
            setStatusMessage(
              getErrorMessage(err, 'Could not check the saved connection')
            );
          }
        } else if (data) {
          setConnectionStatus(
            data.status === 'connected' ? 'connected' : 'disconnected'
          );
          setResetReason(null);
          setStatusMessage('');
        } else {
          setConnectionStatus('disconnected');
          setResetReason(null);
          setStatusMessage('');
        }
      } catch (err) {
        console.error('fetchConfig error:', err);
        setLoadError(
          getErrorMessage(err, 'Could not load the WhatsApp connection')
        );
      } finally {
        setLoading(false);
      }
    },
    [canEdit, supabase]
  );

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!userId || !accountId) {
        loadedAccountIdRef.current = null;
        setLoading(false);
        return;
      }
      if (loadedAccountIdRef.current === accountId) return;
      loadedAccountIdRef.current = accountId;
      await fetchConfig(accountId);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, profileLoading, userId, accountId, fetchConfig]);

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('Phone Number ID is required');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for initial setup');
      return;
    }

    try {
      setSaving(true);

      // Always POST through the API — it verifies with Meta and encrypts
      // the access_token server-side with ENCRYPTION_KEY. Skipping this
      // and writing direct to Supabase stores the token in plaintext,
      // which then fails decryption on every subsequent health check.
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        // Optional — only sent when the user filled it in. The server
        // requires it on first save or when changing numbers; for a
        // simple token rotation, leaving it blank skips re-register.
        pin: pin.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        // Existing config — reuse stored encrypted token by decrypting on the
        // server. But our POST handler requires an access_token to verify
        // with Meta. If the user didn't change the token, we need to signal
        // that. Simplest: require token re-entry if they're updating.
        toast.error('Please re-enter the Access Token to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      // The route now returns a structured outcome:
      //   * registered=true   → number is live, events will flow
      //   * registered=false  → credentials saved but /register
      //                         failed; UI shows the specific error
      //                         and a retry path. registration_error
      //                         is human-readable from Meta.
      if (data.registered === false && data.registration_error) {
        toast.error(
          `Saved, but Meta couldn't register the number: ${data.registration_error}`,
          { duration: 12000 }
        );
      } else if (data.registration_skipped) {
        // Credentials saved + verified, but /register was skipped
        // because no PIN was supplied (e.g. a Meta test number).
        // Don't claim the number is "Live" — point at the
        // Registration status banner instead.
        toast.success(
          'Credentials saved and verified. Inbound registration was skipped (no PIN) — see Registration status below.',
          { duration: 10000 }
        );
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} can now receive events.`
            : 'WhatsApp connected. Events will start flowing within a minute.'
        );
        // Clear the PIN so subsequent saves don't accidentally
        // re-register (which would void the active subscription if
        // the PIN became stale).
        setPin('');
      }

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(getErrorMessage(err, 'Failed to save configuration'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.error || 'Could not check the connection');
      }

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Connected to ${payload.phone_info.verified_name}`
            : 'API connection successful'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset
            ? 'token_corrupted'
            : payload.reason === 'meta_api_error'
              ? 'meta_api_error'
              : null
        );
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error(
        getErrorMessage(
          err,
          'Connection test failed. Check network and try again.'
        )
      );
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration', {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      if (!res.ok) {
        throw new Error(
          'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not check inbound delivery'
        );
      }
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Number is fully wired — Meta is delivering events.');
      } else {
        toast.error(
          'Number is not fully registered. See the checks below for which step failed.',
          { duration: 8000 }
        );
      }
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error(getErrorMessage(err, 'Could not check inbound delivery'));
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleReset() {
    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }

      toast.success(
        'Configuration cleared. You can now re-enter your credentials.'
      );
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
      setResetDialogOpen(false);
    } catch (err) {
      console.error('Reset error:', err);
      toast.error(getErrorMessage(err, 'Failed to reset configuration'));
    } finally {
      setResetting(false);
    }
  }

  async function handleCopyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success('Webhook URL copied');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not copy the webhook URL'));
    }
  }

  // The verify token is a shared secret the user invents, then pastes
  // identically into Meta's webhook settings. Most people either reuse
  // a weak string or get stuck on "what do I even put here?" — so we
  // mint a strong random one for them. crypto.getRandomValues gives
  // cryptographically-secure bytes (unlike Math.random). 16 bytes =
  // 128 bits of entropy, rendered as hex with a readable prefix so
  // it's recognisable in Meta's dashboard.
  async function handleGenerateVerifyToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      ''
    );
    const token = `usefuldesk_${hex}`;
    setVerifyToken(token);
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Verify token generated and copied');
    } catch {
      // Clipboard can reject on insecure origins. The generated token remains
      // visible in the field so the user can copy it manually.
      toast.success('Verify token generated. Copy it from the field.');
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WhatsApp"
          leading={<WhatsAppMark />}
          description="Connect and monitor the WhatsApp number your team uses."
        />
        <div
          className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking connection…
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WhatsApp"
          leading={<WhatsAppMark />}
          description="Connect and monitor the WhatsApp number your team uses."
        />
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Connection details unavailable</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => accountId && void fetchConfig(accountId)}
              disabled={!accountId}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp"
        leading={<WhatsAppMark />}
        description="Connect and monitor the WhatsApp number your team uses."
      />
      <div className="space-y-6">
        {!canEdit && (
          <Alert>
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>
              Only admins and owners can change or verify the WhatsApp
              connection.
            </AlertDescription>
          </Alert>
        )}

        {/* Corrupted-token reset banner */}
        {showResetBanner && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Saved token can&apos;t be read</AlertTitle>
            <AlertDescription>
              <p>{statusMessage}</p>
              <GatedButton
                variant="destructive"
                size="sm"
                className="mt-3"
                onClick={() => setResetDialogOpen(true)}
                canAct={canEdit}
                gateReason="reset the WhatsApp connection"
              >
                <RotateCcw />
                Reset connection
              </GatedButton>
            </AlertDescription>
          </Alert>
        )}

        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>Connection status</CardTitle>
            <CardDescription>
              API access and inbound delivery are checked separately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                {connectionStatus === 'connected' ? (
                  <CheckCircle2 className="text-emerald-foreground mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="text-red-foreground mt-0.5 size-4 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-foreground font-medium">API access</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {connectionStatus === 'connected'
                      ? canEdit
                        ? 'Meta accepted the saved credentials.'
                        : 'Credentials are saved for this branch.'
                      : statusMessage ||
                        'No working WhatsApp connection is saved yet.'}
                  </p>
                </div>
              </div>
              <GatedButton
                variant="outline"
                size="sm"
                className="self-start"
                onClick={handleTestConnection}
                disabled={testing || !config}
                canAct={canEdit}
                gateReason="verify the WhatsApp connection"
              >
                {testing ? <Loader2 className="animate-spin" /> : <Zap />}
                {testing ? 'Checking…' : 'Check access'}
              </GatedButton>
            </div>

            {config && (
              <>
                <Separator />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {isRegistered ? (
                      <CheckCircle2 className="text-emerald-foreground mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="text-amber-foreground mt-0.5 size-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-foreground font-medium">
                        {isRegistered
                          ? 'Inbound delivery active'
                          : 'Inbound delivery needs attention'}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {isRegistered ? (
                          <>
                            Registered with Meta
                            {config.registered_at
                              ? ` on ${fmt.dateTime(config.registered_at)}`
                              : ''}
                            .
                          </>
                        ) : lastRegistrationError ? (
                          <>
                            Meta reported:{' '}
                            <span className="text-red-foreground">
                              {lastRegistrationError}
                            </span>
                            . Open Manual setup, correct the PIN, and save
                            again.
                          </>
                        ) : (
                          'Open Manual setup, enter the 2-step PIN if Meta requires one, and save again.'
                        )}
                      </p>
                    </div>
                  </div>
                  <GatedButton
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={handleVerifyRegistration}
                    disabled={verifyingRegistration}
                    canAct={canEdit}
                    gateReason="verify inbound delivery"
                  >
                    {verifyingRegistration ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Zap />
                    )}
                    {verifyingRegistration ? 'Checking…' : 'Check delivery'}
                  </GatedButton>
                </div>
              </>
            )}

            {registrationProbe && (
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-foreground text-sm font-medium">
                  Last delivery check:{' '}
                  {registrationProbe.live ? 'ready' : 'needs attention'}
                </p>
                <ul className="text-muted-foreground mt-2 space-y-1.5 text-sm">
                  {Object.entries(registrationProbe.checks).map(
                    ([key, value]) => (
                      <li key={key} className="flex items-center gap-2">
                        {value === true ? (
                          <CheckCircle2 className="text-emerald-foreground size-3.5 shrink-0" />
                        ) : value === false ? (
                          <XCircle className="text-red-foreground size-3.5 shrink-0" />
                        ) : (
                          <span className="border-border size-3.5 shrink-0 rounded-full border" />
                        )}
                        {REGISTRATION_CHECK_LABELS[key] ?? key}
                      </li>
                    )
                  )}
                </ul>
                {(registrationProbe.errors ?? []).length > 0 && (
                  <ul className="text-red-foreground mt-2 space-y-1 text-sm">
                    {registrationProbe.errors?.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Embedded Signup — the default connect path (renders only
            when the Meta app id + config id env vars are set). */}
        <WhatsAppEmbeddedSignup
          hasExistingConfig={Boolean(config)}
          canEdit={canEdit}
          onConnected={() => {
            if (accountId) void fetchConfig(accountId);
          }}
        />

        {/* Manual setup — the original credential form. Collapsed
            behind "Advanced" when Embedded Signup is available. */}
        <Accordion defaultValue={EMBEDDED_SIGNUP_AVAILABLE ? [] : ['manual']}>
          <AccordionItem value="manual">
            <AccordionTrigger>Manual setup</AccordionTrigger>
            <AccordionContent className="pt-2">
              <div className="grid gap-6 px-1 py-1 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
                  {/* API Credentials */}
                  <Card>
                    <CardHeader>
                      <CardTitle>API credentials</CardTitle>
                      <CardDescription>
                        Use this only when Meta&apos;s guided connection is
                        unavailable.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-phone-number-id">
                          Phone Number ID
                        </Label>
                        <Input
                          id="whatsapp-phone-number-id"
                          placeholder="e.g. 100234567890123"
                          value={phoneNumberId}
                          onChange={(e) => setPhoneNumberId(e.target.value)}
                          disabled={!canEdit || saving}
                          autoComplete="off"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-waba-id">
                          WhatsApp Business Account ID
                        </Label>
                        <Input
                          id="whatsapp-waba-id"
                          placeholder="e.g. 100234567890456"
                          value={wabaId}
                          onChange={(e) => setWabaId(e.target.value)}
                          disabled={!canEdit || saving}
                          autoComplete="off"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-access-token">
                          Permanent access token
                        </Label>
                        <div className="relative">
                          <Input
                            id="whatsapp-access-token"
                            type={showToken ? 'text' : 'password'}
                            placeholder="Enter your access token"
                            value={accessToken}
                            onChange={(e) => {
                              setAccessToken(e.target.value);
                              setTokenEdited(true);
                            }}
                            onFocus={() => {
                              if (accessToken === MASKED_TOKEN) {
                                setAccessToken('');
                                setTokenEdited(true);
                              }
                            }}
                            className="pr-10"
                            disabled={!canEdit || saving}
                            autoComplete="off"
                            aria-describedby={
                              config && !tokenEdited
                                ? 'whatsapp-access-token-help'
                                : undefined
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setShowToken((visible) => !visible)}
                            className="absolute top-1/2 right-1 -translate-y-1/2"
                            aria-label={
                              showToken
                                ? 'Hide access token'
                                : 'Show access token'
                            }
                            aria-pressed={showToken}
                            disabled={!canEdit || saving}
                          >
                            {showToken ? <EyeOff /> : <Eye />}
                          </Button>
                        </div>
                        {config && !tokenEdited && (
                          <p
                            id="whatsapp-access-token-help"
                            className="text-muted-foreground text-xs"
                          >
                            Hidden for security. Re-enter it before saving any
                            manual change.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-verify-token">
                          Webhook verify token
                        </Label>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            id="whatsapp-verify-token"
                            placeholder="Create a custom verify token"
                            value={verifyToken}
                            onChange={(e) => setVerifyToken(e.target.value)}
                            disabled={!canEdit || saving}
                            autoComplete="off"
                            aria-describedby="whatsapp-verify-token-help"
                          />
                          <GatedButton
                            type="button"
                            variant="outline"
                            onClick={handleGenerateVerifyToken}
                            canAct={canEdit}
                            gateReason="generate a webhook token"
                            disabled={saving}
                          >
                            <Wand2 />
                            Generate
                          </GatedButton>
                        </div>
                        <p
                          id="whatsapp-verify-token-help"
                          className="text-muted-foreground text-xs"
                        >
                          Must match the verify token in Meta&apos;s webhook
                          settings.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-pin">
                          Two-step verification PIN (optional)
                        </Label>
                        <Input
                          id="whatsapp-pin"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="6-digit PIN from Meta WhatsApp Manager"
                          value={pin}
                          onChange={(e) =>
                            setPin(
                              e.target.value.replace(/\D/g, '').slice(0, 6)
                            )
                          }
                          className="tracking-widest"
                          disabled={!canEdit || saving}
                          autoComplete="off"
                          aria-describedby="whatsapp-pin-help"
                        />
                        <p
                          id="whatsapp-pin-help"
                          className="text-muted-foreground text-xs leading-relaxed"
                        >
                          Enter the 6-digit PIN from WhatsApp Manager only when
                          Meta requires registration for a production number.
                          Leave blank for test numbers or to keep an existing
                          registration unchanged.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Webhook URL */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Webhook callback</CardTitle>
                      <CardDescription>
                        Paste this URL into the Meta App Dashboard.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-webhook-url">
                          Callback URL
                        </Label>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            id="whatsapp-webhook-url"
                            readOnly
                            value={webhookUrl}
                            className="font-mono text-sm"
                          />
                          <GatedButton
                            variant="outline"
                            size="icon"
                            onClick={handleCopyWebhookUrl}
                            canAct={canEdit}
                            gateReason="copy the webhook URL"
                            aria-label="Copy webhook URL"
                          >
                            <Copy />
                          </GatedButton>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <GatedButton
                    onClick={handleSave}
                    disabled={saving}
                    canAct={canEdit}
                    gateReason="save the WhatsApp connection"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save connection'
                    )}
                  </GatedButton>
                </div>

                <div>
                  <Card>
                    <CardHeader>
                      <CardTitle>Manual setup guide</CardTitle>
                      <CardDescription>
                        Complete these steps in Meta before saving here.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Accordion>
                        <AccordionItem>
                          <AccordionTrigger>
                            1. Create a Meta app
                          </AccordionTrigger>
                          <AccordionContent className="text-muted-foreground">
                            <ol className="list-inside list-decimal space-y-1 text-sm">
                              <li>
                                Go to{' '}
                                <span className="text-primary-text">
                                  developers.facebook.com
                                </span>
                              </li>
                              <li>
                                Click &quot;My Apps&quot; and then &quot;Create
                                App&quot;
                              </li>
                              <li>
                                Select &quot;Business&quot; as the app type
                              </li>
                              <li>Fill in app details and create</li>
                            </ol>
                          </AccordionContent>
                        </AccordionItem>

                        <AccordionItem>
                          <AccordionTrigger>2. Add WhatsApp</AccordionTrigger>
                          <AccordionContent className="text-muted-foreground">
                            <ol className="list-inside list-decimal space-y-1 text-sm">
                              <li>
                                In your app dashboard, click &quot;Add
                                Product&quot;
                              </li>
                              <li>
                                Find &quot;WhatsApp&quot; and click &quot;Set
                                Up&quot;
                              </li>
                              <li>
                                Follow the setup wizard to link your business
                              </li>
                            </ol>
                          </AccordionContent>
                        </AccordionItem>

                        <AccordionItem>
                          <AccordionTrigger>
                            3. Get API credentials
                          </AccordionTrigger>
                          <AccordionContent className="text-muted-foreground">
                            <ol className="list-inside list-decimal space-y-1 text-sm">
                              <li>Go to WhatsApp &gt; API Setup</li>
                              <li>
                                Copy your{' '}
                                <strong className="text-foreground">
                                  Phone Number ID
                                </strong>
                              </li>
                              <li>
                                Copy your{' '}
                                <strong className="text-foreground">
                                  WhatsApp Business Account ID
                                </strong>
                              </li>
                              <li>
                                Generate a{' '}
                                <strong className="text-foreground">
                                  Permanent Access Token
                                </strong>{' '}
                                from Business Settings &gt; System Users
                              </li>
                            </ol>
                          </AccordionContent>
                        </AccordionItem>

                        <AccordionItem>
                          <AccordionTrigger>
                            4. Configure webhooks
                          </AccordionTrigger>
                          <AccordionContent className="text-muted-foreground">
                            <ol className="list-inside list-decimal space-y-1 text-sm">
                              <li>Go to WhatsApp &gt; Configuration</li>
                              <li>
                                Click &quot;Edit&quot; on the Webhook section
                              </li>
                              <li>
                                Paste the{' '}
                                <strong className="text-foreground">
                                  Webhook Callback URL
                                </strong>{' '}
                                from above
                              </li>
                              <li>
                                Enter the same{' '}
                                <strong className="text-foreground">
                                  Verify Token
                                </strong>{' '}
                                you set here
                              </li>
                              <li>
                                Subscribe to &quot;messages&quot; webhook field
                              </li>
                            </ol>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>

                      <div className="border-border mt-4 border-t pt-4">
                        <a
                          data-slot="button"
                          href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonVariants({
                            variant: 'link',
                            size: 'sm',
                          })}
                        >
                          <ExternalLink />
                          Meta setup guide
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {config && (
          <div className="border-border flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-foreground text-sm font-medium">
                Reset connection
              </p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Removes the saved number and credentials from this branch.
              </p>
            </div>
            <GatedButton
              variant="destructive"
              onClick={() => setResetDialogOpen(true)}
              canAct={canEdit}
              gateReason="reset the WhatsApp connection"
            >
              <RotateCcw />
              Reset
            </GatedButton>
          </div>
        )}
      </div>

      <Dialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          if (!resetting) setResetDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset WhatsApp connection?</DialogTitle>
            <DialogDescription>
              This removes the saved phone number and credentials from this
              branch. WhatsApp messages and inbound events will stop until you
              connect again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Resetting…
                </>
              ) : (
                <>
                  <RotateCcw />
                  Reset connection
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
