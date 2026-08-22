'use client';

// ============================================================
// Settings → Lead capture → Facebook & Instagram lead ads.
//
// A SIBLING of whatsapp-embedded-signup.tsx, not an edit to it: that
// component's `extras` / sessionInfoVersion / WA_EMBEDDED_SIGNUP message
// listener are WhatsApp-only. Both share the FB SDK loader
// (src/lib/meta/fb-sdk.ts) so FB.init runs once.
//
// DARK-LAUNCH GATE: renders nothing while NEXT_PUBLIC_META_LEADS_CONFIG_ID
// is unset. leads_retrieval + pages_manage_metadata require Meta App
// Review, so until that clears the flow simply cannot work for a real
// gym — better absent than broken.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Megaphone,
  RefreshCw,
  Unplug,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GatedButton } from '@/components/ui/gated-button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { getErrorMessage } from '@/lib/errors';
import { loadFbSdk, type FbLoginResponse } from '@/lib/meta/fb-sdk';
import { createClient } from '@/lib/supabase/client';
import { ProviderMark } from '@/components/brand/provider-mark';
import { useLocale } from '@/hooks/use-locale';
import { resolveMetaLeadPageDisplay } from './meta-leads-health';

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const LEADS_CONFIG_ID = process.env.NEXT_PUBLIC_META_LEADS_CONFIG_ID;

interface PageConfig {
  id: string;
  page_id: string;
  page_name: string | null;
  status: string;
  last_error: string | null;
  last_lead_at: string | null;
  skipped_no_phone: number;
  health_lease_until: string | null;
  health_checked_at: string | null;
  last_healthy_at: string | null;
  last_repair_at: string | null;
  health_error_code: string | null;
  health_error_resolution: string | null;
  consecutive_health_failures: number;
}

export function MetaLeadsConnect() {
  const { accountId, canEditSettings } = useAuth();
  const supabase = createClient();
  const canEdit = canEditSettings;
  const { fmt } = useLocale();

  const [pages, setPages] = useState<PageConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [pageToDisconnect, setPageToDisconnect] = useState<PageConfig | null>(
    null
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!accountId || !LEADS_CONFIG_ID) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('meta_page_config')
        .select(
          'id, page_id, page_name, status, last_error, last_lead_at, skipped_no_phone, health_lease_until, health_checked_at, last_healthy_at, last_repair_at, health_error_code, health_error_resolution, consecutive_health_failures'
        )
        .eq('account_id', accountId);

      if (cancelled) return;
      if (error) {
        // Agents/viewers are denied by RLS here (admin-only table) —
        // that's expected, not an error worth shouting about.
        setPages([]);
      } else {
        setPages((data ?? []) as PageConfig[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, accountId, nonce]);

  const handleConnect = useCallback(async () => {
    if (!META_APP_ID || !LEADS_CONFIG_ID) return;
    setConnecting(true);
    try {
      const FB = await loadFbSdk(META_APP_ID);
      const response = await new Promise<FbLoginResponse>((resolve) => {
        FB.login(resolve, {
          config_id: LEADS_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
        });
      });

      const code = response.authResponse?.code;
      if (!code) {
        // The user closed the popup — not an error worth a red toast.
        setConnecting(false);
        return;
      }

      const res = await fetch('/api/meta/leads/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not connect');

      const connected = (data.connected ?? []) as { name: string }[];
      const skipped = (data.skipped ?? []) as {
        name: string;
        reason: string;
      }[];

      if (connected.length > 0) {
        toast.success(
          `Connected ${connected.length} page${connected.length === 1 ? '' : 's'}`
        );
      }
      for (const s of skipped) {
        toast.error(`${s.name}: ${s.reason}`);
      }
      setNonce((n) => n + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not connect to Facebook'));
    } finally {
      setConnecting(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!canEdit || !pageToDisconnect) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/meta/leads/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageToDisconnect.page_id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error ?? 'Could not disconnect');
      }
      toast.success('Page disconnected');
      setPageToDisconnect(null);
      setNonce((n) => n + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not disconnect the page'));
    } finally {
      setDisconnecting(false);
    }
  }, [canEdit, pageToDisconnect]);

  const handleCheck = useCallback(
    async (page: PageConfig) => {
      if (!canEdit) return;
      setCheckingId(page.id);
      try {
        const response = await fetch('/api/meta/leads/health', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config_id: page.id }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? 'Could not check the connection');
        }
        toast.success(
          data.kind === 'repaired'
            ? 'Lead Ads connection repaired'
            : 'Lead Ads connection checked'
        );
        setNonce((value) => value + 1);
      } catch (error) {
        toast.error(getErrorMessage(error, 'Could not check the connection'));
      } finally {
        setCheckingId(null);
      }
    },
    [canEdit]
  );

  // The dark-launch gate.
  if (!META_APP_ID || !LEADS_CONFIG_ID) return null;

  const totalSkipped = pages.reduce(
    (sum, p) => sum + (p.skipped_no_phone ?? 0),
    0
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ProviderMark provider="meta" />
            Facebook & Instagram lead ads
          </CardTitle>
          <CardDescription>
            Connect your Page and every lead from a Facebook or Instagram lead
            ad lands in Leads automatically, ready for your team to follow up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div
              className="text-muted-foreground flex items-center gap-2 text-sm"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          ) : (
            <>
              {pages.length > 0 && (
                <ul className="space-y-2">
                  {pages.map((page) => {
                    const display = resolveMetaLeadPageDisplay(page);
                    return (
                      <li
                        key={page.id}
                        className="border-border flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-foreground truncate text-sm font-medium">
                              {page.page_name ?? page.page_id}
                            </p>
                            <Badge variant={display.variant}>
                              {display.label}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {display.detail ?? 'Connection checks are passing.'}
                          </p>
                          {page.health_checked_at && (
                            <p className="text-muted-foreground text-xs">
                              Last checked{' '}
                              {fmt.dateTime(page.health_checked_at)}
                            </p>
                          )}
                          {page.last_healthy_at && (
                            <p className="text-muted-foreground text-xs">
                              Last healthy {fmt.dateTime(page.last_healthy_at)}
                            </p>
                          )}
                          <p className="text-muted-foreground text-xs">
                            {page.last_lead_at
                              ? `Last lead ${fmt.dateTime(page.last_lead_at)}`
                              : 'No leads received yet'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {display.reconnect && (
                            <GatedButton
                              canAct={canEdit}
                              gateReason="reconnect Facebook"
                              variant="outline"
                              size="sm"
                              onClick={handleConnect}
                              loading={connecting}
                            >
                              <Megaphone className="size-4" />
                              Reconnect Facebook
                            </GatedButton>
                          )}
                          <GatedButton
                            canAct={canEdit}
                            gateReason="check a Facebook Page"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCheck(page)}
                            loading={checkingId === page.id}
                          >
                            <RefreshCw className="size-4" />
                            Check now
                          </GatedButton>
                          <GatedButton
                            canAct={canEdit}
                            gateReason="disconnect a Facebook Page"
                            variant="destructive-ghost"
                            size="sm"
                            onClick={() => setPageToDisconnect(page)}
                          >
                            <Unplug className="size-4" />
                            Disconnect
                          </GatedButton>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* A lead Meta delivered that we could not use. Actionable,
                so say what to do about it rather than hiding it. */}
              {totalSkipped > 0 && (
                <Alert>
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>
                    {totalSkipped} lead{totalSkipped === 1 ? '' : 's'} skipped
                  </AlertTitle>
                  <AlertDescription>
                    <p>
                      Your Meta lead form doesn&apos;t ask for a phone number,
                      so your team can&apos;t follow up by phone. Add a phone
                      question in Ads Manager to capture it next time.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              <GatedButton
                canAct={canEdit}
                gateReason="connect a Facebook Page"
                onClick={handleConnect}
                loading={connecting}
                variant={pages.length > 0 ? 'outline' : 'default'}
              >
                <Megaphone className="size-4" />
                {pages.length > 0
                  ? 'Connect another page'
                  : 'Connect Facebook Page'}
              </GatedButton>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(pageToDisconnect)}
        onOpenChange={(open) => {
          if (!open && !disconnecting) setPageToDisconnect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Facebook Page?</DialogTitle>
            <DialogDescription>
              New leads from{' '}
              {pageToDisconnect?.page_name ?? pageToDisconnect?.page_id} will
              stop entering UsefulDesk. Existing leads remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPageToDisconnect(null)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              loading={disconnecting}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
