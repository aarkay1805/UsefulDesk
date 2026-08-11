'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Repeat,
  ShieldCheck,
  TriangleAlert,
  Unplug,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canConfigurePaymentGateway } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { upiAvailableFor } from '@/lib/payments/upi';
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

export function RazorpaySettingsCard() {
  const { accountId, accountRole } = useAuth();
  const { locale, fmt } = useLocale();
  const canConfigure = accountRole
    ? canConfigurePaymentGateway(accountRole)
    : false;
  const [connection, setConnection] = useState<BrowserSafeConnection | null>(
    null
  );
  const [health, setHealth] = useState<ConnectionHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const notifiedResult = useRef<string | null>(null);

  useEffect(() => {
    if (!accountId || !canConfigure) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/payments/razorpay/connection', {
          cache: 'no-store',
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
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(
            getErrorMessage(error, 'Failed to load Razorpay connection')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, canConfigure]);

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
  const oauthConnection = connection?.authenticationMode === 'oauth';

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Repeat className="text-primary-text size-4" />
          Auto-pay (Razorpay)
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Connect your gym&apos;s Razorpay account. Money settles directly to
          that account; UsefulDesk never holds it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!upiAvailableFor(locale.currency) ? (
          <p className="text-muted-foreground text-sm">
            Razorpay UPI AutoPay is available for accounts billing in INR. Your
            account currency is {locale.currency}.
          </p>
        ) : !canConfigure ? (
          <p className="text-muted-foreground text-sm">
            Only account owners and admins can connect or disconnect Razorpay.
          </p>
        ) : loading || !connection ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading Razorpay…
          </p>
        ) : (
          <>
            {attentionCount > 0 ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>
                  Payments need attention · {attentionCount}
                </AlertTitle>
                <AlertDescription>
                  Review {health?.failedEventCount ?? 0} failed webhook attempt
                  {(health?.failedEventCount ?? 0) === 1 ? '' : 's'},{' '}
                  {health?.missingLedgerCount ?? 0} missing-ledger event
                  {(health?.missingLedgerCount ?? 0) === 1 ? '' : 's'},{' '}
                  {health?.unappliedChargeCount ?? 0} unapplied charge
                  {(health?.unappliedChargeCount ?? 0) === 1 ? '' : 's'}, and{' '}
                  {health?.setupExceptionCount ?? 0} setup exception
                  {(health?.setupExceptionCount ?? 0) === 1 ? '' : 's'} before
                  retrying payment work.
                  {health?.latestUnappliedReason
                    ? ` Latest: ${health.latestUnappliedReason}`
                    : ''}
                </AlertDescription>
              </Alert>
            ) : null}

            {oauthConnection ? (
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
                    <TriangleAlert />
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
                    <Button
                      variant="outline"
                      onClick={beginConnect}
                      disabled={connecting || !connection.oauthEnabled}
                    >
                      {connecting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Reconnect
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => setDisconnectOpen(true)}
                    disabled={
                      disconnecting ||
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
                <div className="flex items-start gap-3">
                  <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <ShieldCheck className="size-4" />
                  </span>
                  <div>
                    <p className="text-foreground text-sm font-semibold">
                      Connect with Razorpay
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      Authorize UsefulDesk without pasting API keys. You can
                      revoke access at any time.
                    </p>
                  </div>
                </div>
                {connection.oauthEnabled ? (
                  <Button onClick={beginConnect} disabled={connecting}>
                    {connecting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ExternalLink className="size-4" />
                    )}
                    Connect Razorpay
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
              New Razorpay operations stop immediately. Existing payment facts
              remain in UsefulDesk, and you can reconnect later.
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
    </Card>
  );
}
