'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function SessionsCard() {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onConfirm = async () => {
    setSigningOut(true);
    try {
      // scope: 'global' revokes every refresh token for this user
      // across all devices; the next auth-state change on this tab
      // triggers the usual redirect.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        toast.error(getErrorMessage(error, 'Could not sign out. Try again.'));
        return;
      }
      // A global sign-out must rebuild the app without authenticated state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not sign out. Try again.'));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <Card role="region" aria-labelledby="sessions-heading">
        <CardHeader>
          <CardTitle id="sessions-heading" className="flex items-center gap-2">
            <LogOut className="text-primary-text size-4" />
            Active sessions
          </CardTitle>
          <CardDescription>
            End every UsefulDesk session on every device. This does not sign you
            out of Google.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <LogOut className="size-4" />
            Sign out everywhere
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!signingOut) setOpen(nextOpen);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out everywhere?</DialogTitle>
            <DialogDescription>
              This ends every UsefulDesk session, including this one, and
              returns you to the login page. Your Google session is unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={signingOut}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={signingOut}
            >
              {signingOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing out…
                </>
              ) : (
                'Sign out everywhere'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
