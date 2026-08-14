import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { oauthCallbackUrl } from '@/lib/auth/oauth';

type GoogleAuthButtonProps = {
  inviteToken: string | null;
  onErrorChange: (message: string | null) => void;
};

export function GoogleAuthButton({
  inviteToken,
  onErrorChange,
}: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  if (process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== 'true') {
    return null;
  }

  const handleGoogleAuth = async () => {
    onErrorChange(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: oauthCallbackUrl(window.location.origin, inviteToken),
        },
      });

      if (error) {
        onErrorChange(error.message);
        setLoading(false);
      }
    } catch (error) {
      onErrorChange(
        getErrorMessage(error, 'Could not start Google sign-in. Try again.')
      );
      setLoading(false);
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={loading}
        onClick={() => void handleGoogleAuth()}
      >
        {loading ? 'Connecting to Google...' : 'Continue with Google'}
      </Button>

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
