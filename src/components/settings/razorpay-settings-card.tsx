'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Unplug,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canConfigurePaymentGateway } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { upiAvailableFor } from '@/lib/payments/upi';
import { ProviderMark } from '@/components/brand/provider-mark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

type ConnectionStatus =
  | 'connecting'
  | 'ready'
  | 'blocked'
  | 'reconnect_required'
  | 'disconnecting'
  | 'disconnected';

type MerchantStatus =
  | 'unknown'
  | 'activated'
  | 'under_review'
  | 'needs_clarification'
  | 'suspended'
  | 'rejected';

interface BrowserSafeConnection {
  authenticationMode: 'oauth' | null;
  connectionStatus: ConnectionStatus;
  merchantStatus: MerchantStatus;
  providerMode: 'test' | 'live' | null;
  merchantAccountSuffix: string | null;
  configured: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  activationVerifiedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  oauthEnabled: boolean;
}

interface ConnectionHealth {
  failedEventCount: number;
  missingLedgerCount: number;
  unappliedChargeCount: number;
  setupExceptionCount: number;
  paymentLinkExceptionCount: number;
  paymentLinkSetupExceptionCount: number;
  latestUnappliedReason: string | null;
  unappliedCharges: UnappliedCharge[];
}

interface UnappliedCharge {
  id: string;
  amount: number;
  currency: string | null;
  provider_paid_count: number | null;
  reason_code: string;
  reason_message: string;
  gateway_payment_suffix: string;
  member_name: string | null;
  member_number: number | null;
  gateway_paid_at: string | null;
}

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Checking readiness',
  ready: 'Connected',
  blocked: 'Needs attention',
  reconnect_required: 'Reconnect required',
  disconnecting: 'Disconnecting',
  disconnected: 'Not connected',
};

const MERCHANT_LABELS: Record<MerchantStatus, string> = {
  unknown: 'Readiness verified',
  activated: 'Merchant active',
  under_review: 'Under review',
  needs_clarification: 'Details required',
  suspended: 'Merchant suspended',
  rejected: 'Merchant rejected',
};

function connectionBadge(status: ConnectionStatus) {
  if (status === 'ready') return 'success' as const;
  if (status === 'connecting' || status === 'disconnecting') {
    return 'warning' as const;
  }
  if (status === 'blocked' || status === 'reconnect_required') {
    return 'danger' as const;
  }
  return 'neutral' as const;
}

function attentionSummary(health: ConnectionHealth): string {
  const items = [
    [health.failedEventCount, 'failed webhook'],
    [health.missingLedgerCount, 'missing payment record'],
    [health.unappliedChargeCount, 'unapplied charge'],
    [health.setupExceptionCount, 'auto-pay setup issue'],
    [health.paymentLinkExceptionCount, 'payment-link issue'],
    [health.paymentLinkSetupExceptionCount, 'payment-link setup issue'],
  ] as const;

  return items
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`)
    .join(' · ');
}

function RazorpayLoading() {
  return (
    <div
      className="text-muted-foreground flex items-center gap-2 py-4 text-sm"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Checking Razorpay status…
    </div>
  );
}

export function RazorpaySettingsCard() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const { locale, fmt } = useLocale();
  const canConfigure = accountRole
    ? canConfigurePaymentGateway(accountRole)
    : false;
  const [connection, setConnection] = useState<BrowserSafeConnection | null>(
    null
  );
  const [health, setHealth] = useState<ConnectionHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState<{
    charge: UnappliedCharge;
    action: 'apply' | 'ignore';
  } | null>(null);
  const [resolutionReason, setResolutionReason] = useState('');
  const [resolvingCharge, setResolvingCharge] = useState(false);
  const notifiedResult = useRef<string | null>(null);

  useEffect(() => {
    if (profileLoading || !accountId || !canConfigure) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch('/api/payments/razorpay/connection', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || 'Failed to load Razorpay connection');
        }
        if (cancelled) return;
        const next = body.connection as BrowserSafeConnection;
        setConnection(next);
        setHealth({
          failedEventCount: body.health.failedEventCount,
          missingLedgerCount: body.health.missingLedgerCount,
          unappliedChargeCount: body.health.unappliedChargeCount,
          setupExceptionCount: body.health.setupExceptionCount,
          paymentLinkExceptionCount: body.health.paymentLinkExceptionCount,
          paymentLinkSetupExceptionCount:
            body.health.paymentLinkSetupExceptionCount,
          latestUnappliedReason:
            body.health.latestPaymentLinkReason ??
            body.health.unappliedCharges?.[0]?.reason_message ??
            null,
          unappliedCharges: body.health.unappliedCharges ?? [],
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof DOMException && error.name === 'AbortError'
              ? 'The connection check took too long. Try again.'
              : getErrorMessage(
                  error,
                  "Razorpay status couldn't load. Try again."
                )
          );
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [accountId, canConfigure, profileLoading, reloadNonce]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('razorpay');
    if (!result || notifiedResult.current === result) return;
    notifiedResult.current = result;
    if (result === 'connected') toast.success('Razorpay connected');
    else if (result === 'needs_attention') {
      toast.warning(
        'Razorpay connected, but merchant readiness needs attention'
      );
    } else if (result === 'authorization_denied') {
      toast.error('Razorpay authorization was cancelled');
    } else if (result !== 'session_required') {
      toast.error('Razorpay could not be connected');
    }
  }, []);

  const attentionCount = health
    ? health.failedEventCount +
      health.missingLedgerCount +
      health.unappliedChargeCount +
      health.setupExceptionCount +
      health.paymentLinkExceptionCount +
      health.paymentLinkSetupExceptionCount
    : 0;
  const attentionDetails = health ? attentionSummary(health) : '';
  const oauthConnection = connection?.authenticationMode === 'oauth';
  const activeOAuthConnection =
    oauthConnection && connection?.connectionStatus !== 'disconnected';

  async function beginConnect() {
    setConnecting(true);
    try {
      const response = await fetch('/api/payments/razorpay/oauth/connect', {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok || typeof body.authorizeUrl !== 'string') {
        throw new Error(body.error || 'Could not start Razorpay connection');
      }
      window.location.assign(body.authorizeUrl);
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Could not start Razorpay connection')
      );
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch('/api/payments/razorpay/oauth/disconnect', {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not disconnect Razorpay');
      }
      setConnection(body.connection as BrowserSafeConnection);
      setDisconnectOpen(false);
      toast.success('Razorpay disconnected');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not disconnect Razorpay'));
    } finally {
      setDisconnecting(false);
    }
  }

  async function verifyConnection() {
    setVerifying(true);
    try {
      const response = await fetch('/api/payments/razorpay/oauth/refresh', {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not verify Razorpay connection');
      }
      const next = body.connection as BrowserSafeConnection;
      setConnection(next);
      if (next.configured && next.connectionStatus === 'ready') {
        toast.success('Razorpay connection verified');
      } else {
        toast.warning('Razorpay connection needs attention');
      }
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Could not verify Razorpay connection')
      );
    } finally {
      setVerifying(false);
    }
  }

  async function recoverDisconnectingConnection() {
    setRecovering(true);
    try {
      const response = await fetch('/api/payments/razorpay/oauth/recover', {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not verify Razorpay connection');
      }
      setConnection(body.connection as BrowserSafeConnection);
      if (body.readiness === 'ready') {
        toast.success('Razorpay connection verified');
      } else {
        toast.warning('Razorpay connection needs attention');
      }
    } catch (error) {
      try {
        const statusResponse = await fetch(
          '/api/payments/razorpay/connection',
          { cache: 'no-store' }
        );
        const statusBody = await statusResponse.json();
        if (statusResponse.ok) {
          setConnection(statusBody.connection as BrowserSafeConnection);
        }
      } catch {
        // Best-effort refresh: preserve the original provider error below.
      }
      toast.error(
        getErrorMessage(error, 'Could not verify Razorpay connection')
      );
    } finally {
      setRecovering(false);
    }
  }

  function openChargeResolution(
    charge: UnappliedCharge,
    action: 'apply' | 'ignore'
  ) {
    setSelectedResolution({ charge, action });
    setResolutionReason(
      action === 'apply'
        ? 'Revalidated against Razorpay and applied to the membership ledger.'
        : ''
    );
  }

  async function resolveCharge() {
    if (!selectedResolution) return;
    setResolvingCharge(true);
    try {
      const response = await fetch(
        `/api/payments/razorpay/charge-exceptions/${selectedResolution.charge.id}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: selectedResolution.action,
            reason: resolutionReason.trim(),
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Could not resolve Razorpay charge');
      }
      toast.success(
        selectedResolution.action === 'apply'
          ? 'Razorpay charge applied to the membership'
          : 'Razorpay charge marked as handled externally'
      );
      setSelectedResolution(null);
      setResolutionReason('');
      setReloadNonce((nonce) => nonce + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not resolve Razorpay charge'));
    } finally {
      setResolvingCharge(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ProviderMark provider="razorpay" />
          Razorpay
        </CardTitle>
        <CardDescription>
          Connect Razorpay for auto-pay and payment links. Money settles
          directly to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!upiAvailableFor(locale.currency) ? (
          <p className="text-muted-foreground text-sm">
            Razorpay UPI AutoPay is available for accounts billing in INR. Your
            account currency is {locale.currency}.
          </p>
        ) : profileLoading ? (
          <RazorpayLoading />
        ) : !canConfigure ? (
          <Alert>
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>
              Only account owners and admins can connect or disconnect Razorpay.
            </AlertDescription>
          </Alert>
        ) : loading ? (
          <RazorpayLoading />
        ) : loadError ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Razorpay status couldn&apos;t load</AlertTitle>
            <AlertDescription>
              <p>{loadError}</p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3"
                onClick={() => setReloadNonce((nonce) => nonce + 1)}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : !connection ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Razorpay status is unavailable</AlertTitle>
            <AlertDescription>Try the connection check again.</AlertDescription>
          </Alert>
        ) : (
          <>
            {attentionCount > 0 ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>
                  Payments need attention · {attentionCount}
                </AlertTitle>
                <AlertDescription>
                  <p>{attentionDetails}</p>
                  <p className="mt-1">
                    Contact support before retrying affected payment work.
                  </p>
                  {health?.latestUnappliedReason ? (
                    <p className="mt-1">
                      Latest issue: {health.latestUnappliedReason}
                    </p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {health?.unappliedCharges.some(
              (charge) =>
                charge.reason_code === 'provider_charge_missing_webhook'
            ) ? (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <p className="font-medium">Captured charges to review</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Razorpay reports these charges as captured, but UsefulDesk
                    did not receive the webhook. Applying rechecks Razorpay and
                    does not charge the member again.
                  </p>
                </div>
                <div className="divide-y">
                  {(health?.unappliedCharges ?? [])
                    .filter(
                      (charge) =>
                        charge.reason_code === 'provider_charge_missing_webhook'
                    )
                    .map((charge) => (
                      <div
                        key={charge.id}
                        className="space-y-2 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {charge.member_name ?? 'Unknown member'}
                              {charge.member_number !== null
                                ? ` · Member #${charge.member_number}`
                                : ''}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              Payment ending {charge.gateway_payment_suffix}
                              {charge.provider_paid_count !== null
                                ? ` · Charge #${charge.provider_paid_count}`
                                : ''}
                            </p>
                          </div>
                          <p className="font-medium tabular-nums">
                            {fmt.money(charge.amount)}
                          </p>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {charge.gateway_paid_at
                            ? `Captured ${fmt.dateTime(charge.gateway_paid_at)}`
                            : 'Provider payment time unavailable'}
                          {charge.currency ? ` · ${charge.currency}` : ''}
                        </p>
                        <p className="text-sm">{charge.reason_message}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              openChargeResolution(charge, 'apply')
                            }
                          >
                            Apply to membership
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              openChargeResolution(charge, 'ignore')
                            }
                          >
                            Mark handled externally
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            {activeOAuthConnection ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={connectionBadge(connection.connectionStatus)}>
                    {CONNECTION_LABELS[connection.connectionStatus]}
                  </Badge>
                  <Badge
                    variant={
                      connection.merchantStatus === 'activated' ||
                      connection.merchantStatus === 'unknown'
                        ? 'info'
                        : 'warning'
                    }
                  >
                    {MERCHANT_LABELS[connection.merchantStatus]}
                  </Badge>
                  {connection.providerMode ? (
                    <Badge variant="neutral">
                      {connection.providerMode === 'test'
                        ? 'Test mode'
                        : 'Live mode'}
                    </Badge>
                  ) : null}
                </div>

                <div className="bg-muted/20 grid gap-2 rounded-lg p-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground text-xs">Merchant</p>
                    <p className="text-foreground font-medium">
                      {connection.merchantAccountSuffix
                        ? `Razorpay account ending ${connection.merchantAccountSuffix}`
                        : 'Merchant identity unavailable'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Last verified
                    </p>
                    <p className="text-foreground font-medium">
                      {connection.lastVerifiedAt
                        ? fmt.dateTime(connection.lastVerifiedAt)
                        : 'Not yet verified'}
                    </p>
                  </div>
                </div>

                {connection.lastError ? (
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden="true" />
                    <AlertTitle>Razorpay needs attention</AlertTitle>
                    <AlertDescription>{connection.lastError}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {connection.connectionStatus === 'disconnecting' ? (
                    <Button
                      variant="outline"
                      onClick={recoverDisconnectingConnection}
                      disabled={recovering}
                    >
                      {recovering ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Recheck connection
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={verifyConnection}
                        disabled={
                          verifying || connecting || !connection.oauthEnabled
                        }
                      >
                        {verifying ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        Verify connection
                      </Button>
                      <Button
                        variant="outline"
                        onClick={beginConnect}
                        disabled={
                          connecting || verifying || !connection.oauthEnabled
                        }
                      >
                        {connecting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        Reconnect
                      </Button>
                    </>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => setDisconnectOpen(true)}
                    disabled={
                      disconnecting ||
                      verifying ||
                      recovering ||
                      connection.connectionStatus === 'disconnecting'
                    }
                  >
                    {disconnecting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Unplug className="size-4" />
                    )}
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">
                    {oauthConnection
                      ? 'Reconnect Razorpay'
                      : 'Connect with Razorpay'}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Authorize UsefulDesk without sharing API keys. You can
                    disconnect after active payment work is resolved.
                  </p>
                </div>
                {connection.oauthEnabled ? (
                  <Button onClick={beginConnect} disabled={connecting}>
                    {connecting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ExternalLink className="size-4" />
                    )}
                    {oauthConnection
                      ? 'Reconnect Razorpay'
                      : 'Connect Razorpay'}
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Razorpay OAuth is disabled for this environment.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={disconnectOpen}
        onOpenChange={(open) => {
          if (!disconnecting) setDisconnectOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Razorpay?</DialogTitle>
            <DialogDescription>
              Disconnect is refused while an auto-pay mandate, payment link,
              refund, or recovery item still needs Razorpay. Existing payment
              facts remain in UsefulDesk, and you can reconnect later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={disconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedResolution !== null}
        onOpenChange={(open) => {
          if (!open && !resolvingCharge) {
            setSelectedResolution(null);
            setResolutionReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedResolution?.action === 'apply'
                ? 'Apply captured charge?'
                : 'Mark charge handled externally?'}
            </DialogTitle>
            <DialogDescription>
              {selectedResolution?.action === 'apply'
                ? 'UsefulDesk will recheck the subscription, invoice, payment, and refund state in Razorpay before atomically posting this charge. This does not debit the member again.'
                : 'No payment or membership credit will be created. Use this only when the captured money has been accounted for outside UsefulDesk.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="charge-resolution-note"
            >
              Resolution note
            </label>
            <Textarea
              id="charge-resolution-note"
              value={resolutionReason}
              onChange={(event) => setResolutionReason(event.target.value)}
              maxLength={500}
              placeholder="Explain how this charge should be handled"
              disabled={resolvingCharge}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedResolution(null);
                setResolutionReason('');
              }}
              disabled={resolvingCharge}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={
                selectedResolution?.action === 'ignore'
                  ? 'destructive'
                  : 'default'
              }
              onClick={resolveCharge}
              disabled={resolutionReason.trim().length < 3 || resolvingCharge}
            >
              {resolvingCharge ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {selectedResolution?.action === 'apply'
                ? 'Recheck and apply'
                : 'Mark handled externally'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
