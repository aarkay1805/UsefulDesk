'use client';

// ============================================================
// AccountDangerZone — Settings → Members (bottom)
//
// Owner-only branch closure. DELETE /api/account is retained as the
// compatibility verb, but it archives the branch and preserves financial,
// member, and message history.
//
// Guardrail mirrors the API: the Delete button stays disabled until
// the owner types the account name exactly (the GitHub/Stripe pattern
// for a sensitive lifecycle change). On success we hard-reload so every
// branch-scoped request, cache, dialog, and subscription is torn down.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { branchHref } from '@/lib/auth/branch-context';
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
  const { account, branches } = useAuth();
  const canArchive = useCan('archive-branch');

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  // Self-gate: only the owner ever sees this section.
  if (!canArchive || !account) return null;

  const accountName = account.name;
  const accountId = account.id;
  const confirmed = typed.trim() === accountName;

  async function handleArchive() {
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
        toast.error(payload.error || 'Failed to archive the branch');
        setBusy(false);
        return;
      }
      toast.success('Branch archived');
      const nextBranch = branches.find(
        (branch) =>
          branch.account_id !== accountId && branch.branch_status === 'active'
      );
      window.location.href = nextBranch
        ? branchHref('/dashboard', nextBranch.account_id)
        : '/dashboard';
    } catch (err) {
      console.error('[AccountDangerZone] archive error:', err);
      toast.error('Could not reach the server');
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-500/30">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle className="size-4" />
              Archive branch
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Close <span className="font-medium">{accountName}</span> for new
              operational work while retaining its contacts, messages,
              memberships, payments, and finance history for audit and reports.
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
            <Trash2 className="size-4" /> Archive branch
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
              <AlertTriangle className="text-destructive size-4" />
              Archive {accountName}?
            </DialogTitle>
            <DialogDescription>
              This branch becomes unavailable for operational work. Historical
              financial and message records are retained, and other branch
              memberships remain unchanged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="delete-account-confirm"
              className="text-muted-foreground text-sm"
            >
              Type{' '}
              <span className="text-foreground font-medium">{accountName}</span>{' '}
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
              onClick={handleArchive}
              disabled={!confirmed || busy}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Archiving…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" /> Archive branch
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
