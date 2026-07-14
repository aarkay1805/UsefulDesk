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
import { AlertTriangle, Loader2, Megaphone, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GatedButton } from '@/components/ui/gated-button';
import { useAuth } from '@/hooks/use-auth';
import { getErrorMessage } from '@/lib/errors';
import { loadFbSdk, type FbLoginResponse } from '@/lib/meta/fb-sdk';
import { createClient } from '@/lib/supabase/client';

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
}

export function MetaLeadsConnect() {
  const { accountId, canEditSettings } = useAuth();
  const supabase = createClient();
  const canEdit = canEditSettings;

  const [pages, setPages] = useState<PageConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!accountId || !LEADS_CONFIG_ID) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('meta_page_config')
        .select('id, page_id, page_name, status, last_error, last_lead_at, skipped_no_phone')
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
      const skipped = (data.skipped ?? []) as { name: string; reason: string }[];

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

  const handleDisconnect = useCallback(async (pageId: string) => {
    try {
      const res = await fetch('/api/meta/leads/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error ?? 'Could not disconnect');
      }
      toast.success('Page disconnected');
      setNonce((n) => n + 1);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not disconnect the page'));
    }
  }, []);

  // The dark-launch gate.
  if (!META_APP_ID || !LEADS_CONFIG_ID) return null;

  const totalSkipped = pages.reduce((sum, p) => sum + (p.skipped_no_phone ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Facebook & Instagram lead ads</CardTitle>
        <CardDescription>
          Connect your Page and every lead from a Facebook or Instagram lead
          ad lands in Leads automatically, ready to follow up on WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {pages.length > 0 && (
              <ul className="space-y-2">
                {pages.map((page) => (
                  <li
                    key={page.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {page.page_name ?? page.page_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {page.status === 'error'
                          ? (page.last_error ?? 'Needs attention')
                          : page.last_lead_at
                            ? 'Receiving leads'
                            : 'Connected — no leads yet'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(page.page_id)}
                      disabled={!canEdit}
                    >
                      <Unplug className="size-4" />
                      Disconnect
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {/* A lead Meta delivered that we could not use. Actionable,
                so say what to do about it rather than hiding it. */}
            {totalSkipped > 0 && (
              <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium text-foreground">
                    {totalSkipped} lead{totalSkipped === 1 ? '' : 's'} skipped
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your Meta lead form doesn&apos;t ask for a phone number, so
                    we can&apos;t reach these people on WhatsApp. Add a phone
                    question in Ads Manager to capture them.
                  </p>
                </div>
              </div>
            )}

            <GatedButton
              canAct={canEdit}
              gateReason="connect a Facebook Page"
              onClick={handleConnect}
              disabled={connecting}
              variant={pages.length > 0 ? 'outline' : 'default'}
            >
              {connecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Megaphone className="size-4" />
              )}
              {pages.length > 0 ? 'Connect another page' : 'Connect Facebook Page'}
            </GatedButton>
          </>
        )}
      </CardContent>
    </Card>
  );
}
