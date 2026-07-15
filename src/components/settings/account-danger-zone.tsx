'use client';

// ============================================================
// AccountDangerZone — Settings → Members (bottom)
//
// Owner-only, irreversible: permanently delete the whole account and
// every scrap of its Platform Data via DELETE /api/account. The route
// re-checks owner role + the typed name server-side, so this UI gate
// is defence-in-depth, not the only guard.
//
// Guardrail mirrors the API: the Delete button stays disabled until
// the owner types the account name exactly (the GitHub/Stripe pattern
// for an unrecoverable delete). On success the account — including the
// caller's own login — is gone, so we hard-navigate to the root, which
// the proxy bounces to sign-in.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function AccountDangerZone() {
  const { account } = useAuth();
  const canDelete = useCan('delete-account');

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // Self-gate: only the owner ever sees this section.
  if (!canDelete || !account) return null;

  const accountName = account.name;
  const confirmed = typed.trim() === accountName;

  async function handleDelete() {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete the account');
        setBusy(false);
        return;
      }
      // Account + this login are gone. Hard-navigate so no stale client
      // state (Supabase session, cached queries) lingers; the proxy
      // redirects the now-unauthenticated request to sign-in.
      toast.success('Account deleted');
      window.location.href = '/';
    } catch (err) {
      console.error('[AccountDangerZone] delete error:', err);
      toast.error('Could not reach the server');
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-500/30">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              Delete account
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently delete <span className="font-medium">{accountName}</span>{' '}
              and everything in it — every contact, conversation, message,
              connected WhatsApp credential, member, and teammate login. This
              cannot be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setTyped('');
              setOpen(true);
            }}
          >
            <Trash2 className="size-4" /> Delete account
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Delete {accountName}?
            </DialogTitle>
            <DialogDescription>
              This permanently erases all account data and signs out every
              teammate — their logins are deleted too. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="delete-account-confirm"
              className="text-sm text-muted-foreground"
            >
              Type <span className="font-medium text-foreground">{accountName}</span>{' '}
              to confirm.
            </label>
            <Input
              id="delete-account-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={accountName}
              disabled={busy}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!confirmed || busy}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" /> Delete account
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
