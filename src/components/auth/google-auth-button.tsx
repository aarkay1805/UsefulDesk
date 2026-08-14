import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import {
  generateGoogleNonce,
  GOOGLE_AVATAR_SEED_METADATA_KEY,
  resolveInitialGoogleAvatar,
  type GoogleNonce,
} from '@/lib/auth/google-identity';
import { navigateAfterLogin } from '@/lib/auth/post-login-navigation';

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentity = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce: string;
    ux_mode: 'popup';
    use_fedcm_for_button: boolean;
    button_auto_select: boolean;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    config: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'continue_with';
      shape: 'rectangular';
      logo_alignment: 'left';
      width: number;
      click_listener: () => void;
    }
  ) => void;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      id?: GoogleIdentity;
    };
  };
};

type Phase = 'loading' | 'ready' | 'waiting' | 'exchanging' | 'script-error';

type GoogleAuthButtonProps = {
  inviteToken: string | null;
  onErrorChange: (message: string | null) => void;
};

export function GoogleAuthButton({
  inviteToken,
  onErrorChange,
}: GoogleAuthButtonProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState<GoogleNonce | null>(null);
  const [useFedcm, setUseFedcm] = useState(true);
  const buttonRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>('loading');
  const preparationRef = useRef(0);
  const popupBlurredRef = useRef(false);

  const enabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const prepareAttempt = useCallback(async (preferFedcm = true) => {
    const preparation = ++preparationRef.current;
    setAttempt(null);
    setUseFedcm(preferFedcm);
    phaseRef.current = 'loading';
    setPhase('loading');
    popupBlurredRef.current = false;

    try {
      const nextAttempt = await generateGoogleNonce();
      if (preparation !== preparationRef.current) return;
      setAttempt(nextAttempt);
      phaseRef.current = 'ready';
      setPhase('ready');
    } catch (error) {
      if (preparation !== preparationRef.current) return;
      onErrorChange(
        getErrorMessage(
          error,
          'Could not secure Google sign-in. Refresh and try again.'
        )
      );
      phaseRef.current = 'script-error';
      setPhase('script-error');
    }
  }, [onErrorChange]);

  const handleCredential = useCallback(
    async (
      response: GoogleCredentialResponse,
      rawNonce: string,
      attemptedWithFedcm: boolean
    ) => {
      phaseRef.current = 'exchanging';
      setPhase('exchanging');
      onErrorChange(null);

      try {
        if (!response.credential) {
          throw new Error('Google did not return a sign-in credential.');
        }

        const supabase = createClient();
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: response.credential,
          nonce: rawNonce,
        });

        if (error) throw error;

        // A first-time Google account may safely inherit its provider photo,
        // but only while UsefulDesk has no avatar. The first-sign-in guard
        // prevents a later Google login from undoing Remove.
        const avatarSeed = data.user
          ? resolveInitialGoogleAvatar(data.user)
          : null;
        if (avatarSeed) {
          // Mark the one allowed attempt before touching the profile. If the
          // marker cannot be persisted, skip the seed rather than risk a
          // future Google login undoing the user's Remove choice.
          const { error: markerError } = await supabase.auth.updateUser({
            data: {
              ...data.user.user_metadata,
              [GOOGLE_AVATAR_SEED_METADATA_KEY]: true,
            },
          });
          if (markerError) {
            console.warn('[GoogleAuthButton] avatar seed marker failed:', {
              message: markerError.message,
            });
          } else {
            const { error: avatarError } = await supabase
              .from('profiles')
              .update({ avatar_url: avatarSeed.url })
              .eq('user_id', avatarSeed.userId)
              .is('avatar_url', null)
              .select('id');
            if (avatarError) {
              console.warn('[GoogleAuthButton] initial avatar seed failed:', {
                message: avatarError.message,
              });
            }
          }
        }
        navigateAfterLogin(inviteToken);
      } catch (error) {
        onErrorChange(
          getErrorMessage(error, 'Could not sign in with Google. Try again.')
        );
        void prepareAttempt(attemptedWithFedcm);
      }
    },
    [inviteToken, onErrorChange, prepareAttempt]
  );

  const renderGoogleButton = useCallback(() => {
    const googleIdentity = (window as GoogleWindow).google?.accounts?.id;
    const parent = buttonRef.current;
    if (!googleIdentity || !parent || !attempt || !clientId) return;

    googleIdentity.initialize({
      client_id: clientId,
      callback: (response) =>
        void handleCredential(response, attempt.raw, useFedcm),
      nonce: attempt.hashed,
      ux_mode: 'popup',
      use_fedcm_for_button: useFedcm,
      button_auto_select: false,
    });

    let lastWidth = 0;
    const draw = () => {
      const width = Math.min(400, Math.max(240, parent.clientWidth));
      if (width === lastWidth && parent.childElementCount > 0) return;
      lastWidth = width;
      parent.replaceChildren();
      googleIdentity.renderButton(parent, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width,
        click_listener: () => {
          popupBlurredRef.current = false;
          phaseRef.current = 'waiting';
          setPhase('waiting');
        },
      });
    };

    draw();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [attempt, clientId, handleCredential, useFedcm]);

  useEffect(() => {
    if (phase !== 'ready') return;
    return renderGoogleButton();
  }, [phase, renderGoogleButton]);

  useEffect(() => {
    const handleBlur = () => {
      if (phaseRef.current === 'waiting') popupBlurredRef.current = true;
    };
    const handleFocus = () => {
      if (phaseRef.current !== 'waiting' || !popupBlurredRef.current) return;
      window.setTimeout(() => {
        if (phaseRef.current === 'waiting') void prepareAttempt(false);
      }, 300);
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      preparationRef.current += 1;
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [prepareAttempt]);

  if (!enabled || !clientId) {
    return null;
  }

  return (
    <div className="mb-4 flex flex-col gap-4">
      <Script
        id="google-identity-services"
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => void prepareAttempt()}
        onError={() => {
          phaseRef.current = 'script-error';
          setPhase('script-error');
          onErrorChange(
            'Google sign-in could not load. Check your connection or use email.'
          );
        }}
      />

      <div className="relative min-h-10 w-full">
        <div
          ref={buttonRef}
          className={
            phase === 'ready'
              ? 'w-full'
              : 'pointer-events-none absolute inset-0 opacity-0'
          }
          aria-hidden={phase === 'ready' ? undefined : true}
        />

        {phase === 'waiting' ? (
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled
            >
              Waiting for Google…
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void prepareAttempt(false)}
            >
              Google window closed? Try again
            </Button>
          </div>
        ) : phase === 'script-error' ? (
          <p className="text-muted-foreground text-center text-sm">
            Google sign-in is unavailable. Continue with email below.
          </p>
        ) : phase !== 'ready' ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            disabled
          >
            {phase === 'exchanging'
              ? 'Signing in with Google…'
              : 'Loading Google sign-in…'}
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Separator className="w-auto flex-1" />
        <span className="text-muted-foreground text-xs">
          or continue with email
        </span>
        <Separator className="w-auto flex-1" />
      </div>
    </div>
  );
}
