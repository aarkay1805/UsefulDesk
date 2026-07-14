'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadFbSdk, type FbLoginResponse } from '@/lib/meta/fb-sdk';

// Public identifiers — safe to ship to the browser. When either is
// missing the component renders nothing and the manual credential
// form remains the only path.
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const ES_CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;

// The signup popup posts session info back via window message events
// (sessionInfoVersion 3). FINISH carries the provisioned ids; the
// OAuth code arrives separately through the FB.login callback.
interface SignupSessionInfo {
  waba_id?: string;
  phone_number_id?: string;
}

interface WhatsAppEmbeddedSignupProps {
  /** Called after the server confirms the connection was saved. */
  onConnected: () => void;
  /** True when a config row already exists — softens the copy. */
  hasExistingConfig: boolean;
}

export function WhatsAppEmbeddedSignup({
  onConnected,
  hasExistingConfig,
}: WhatsAppEmbeddedSignupProps) {
  const [connecting, setConnecting] = useState(false);
  // Session info lands via a message event while the popup is still
  // open; the code lands in the login callback after it closes. Refs
  // bridge the two without re-render races.
  const sessionInfoRef = useRef<SignupSessionInfo | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.origin !== 'https://www.facebook.com' &&
        !event.origin.endsWith('.facebook.com')
      ) {
        return;
      }
      if (typeof event.data !== 'string') return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
          sessionInfoRef.current = {
            waba_id: data.data?.waba_id,
            phone_number_id: data.data?.phone_number_id,
          };
        } else if (data.event === 'CANCEL') {
          sessionInfoRef.current = null;
        }
      } catch {
        // Non-JSON messages from facebook.com iframes are normal noise.
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const completeSignup = useCallback(
    async (code: string) => {
      // The FINISH message usually arrives just before the login
      // callback, but not guaranteed — poll briefly for it.
      let info = sessionInfoRef.current;
      for (let i = 0; i < 20 && !info?.waba_id; i++) {
        await new Promise((r) => setTimeout(r, 150));
        info = sessionInfoRef.current;
      }
      if (!info?.waba_id || !info?.phone_number_id) {
        toast.error(
          info?.waba_id
            ? 'Signup finished without a phone number. Re-run Connect and add a phone number inside the Meta popup.'
            : 'Signup finished but Meta did not report the new WhatsApp account. Please try again.',
          { duration: 10000 },
        );
        return;
      }

      const res = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          waba_id: info.waba_id,
          phone_number_id: info.phone_number_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to complete the WhatsApp connection.');
        return;
      }

      if (data.registered === false && data.registration_error) {
        toast.warning(
          `Connected, but Meta couldn't register the number for messaging yet: ${data.registration_error}`,
          { duration: 12000 },
        );
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `WhatsApp connected — ${data.phone_info.verified_name} is live.`
            : 'WhatsApp connected. Events will start flowing within a minute.',
        );
      }
      onConnected();
    },
    [onConnected],
  );

  async function handleConnect() {
    if (!META_APP_ID || !ES_CONFIG_ID) return;
    setConnecting(true);
    sessionInfoRef.current = null;
    submittedRef.current = false;
    try {
      const FB = await loadFbSdk(META_APP_ID);
      FB.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            // User closed the popup or denied — not an error state.
            setConnecting(false);
            return;
          }
          if (submittedRef.current) return;
          submittedRef.current = true;
          void completeSignup(code).finally(() => setConnecting(false));
        },
        {
          config_id: ES_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        },
      );
    } catch (err) {
      console.error('Embedded signup launch failed:', err);
      toast.error(
        err instanceof Error ? err.message : 'Could not open the Meta signup popup.',
      );
      setConnecting(false);
    }
  }

  if (!META_APP_ID || !ES_CONFIG_ID) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">
          {hasExistingConfig ? 'Reconnect with Facebook' : 'Connect with Facebook'}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {hasExistingConfig
            ? 'Re-run Meta’s guided signup to reconnect or switch the WhatsApp number linked to this account.'
            : 'The fastest way to connect: Meta’s guided popup creates your WhatsApp Business account, verifies your phone number, and links it here automatically — no tokens to copy.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={handleConnect}
          disabled={connecting}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {connecting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Waiting for Meta…
            </>
          ) : (
            <>
              <PlugZap className="size-4" />
              {hasExistingConfig ? 'Reconnect WhatsApp' : 'Connect WhatsApp'}
            </>
          )}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          A Meta popup will open. Sign in with the Facebook account that manages your
          business, then follow the steps to select or create a WhatsApp Business
          account and phone number.
        </p>
      </CardContent>
    </Card>
  );
}
