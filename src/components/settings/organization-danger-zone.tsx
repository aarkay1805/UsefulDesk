'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { branchHref } from '@/lib/auth/branch-context';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function OrganizationDangerZone() {
  const { account, branches } = useAuth();
  const canDelete = useCan('delete-organization');
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  if (!account || !canDelete) return null;

  const currentBranch = branches.find(
    (branch) => branch.account_id === account.id
  );
  const organizationName = currentBranch?.organization_name;
  if (!organizationName) return null;

  const confirmed = typed === organizationName;

  async function handleDelete() {
    if (!confirmed || busy) return;
    setBusy(true);

    try {
      const response = await fetch('/api/organization', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        nextAccountId?: string | null;
        warningCount?: number;
      };
      if (!response.ok) {
        toast.error(payload.error || 'Failed to delete the organization');
        setBusy(false);
        return;
      }

      if (payload.warningCount) {
        toast.warning(
          'Organization deleted, but some unused teammate logins need administrator cleanup.'
        );
      } else {
        toast.success('Organization permanently deleted');
      }

      if (payload.nextAccountId) {
        // Tenant deletion changes server-visible auth context; force a reload.
        window.location.href = branchHref('/dashboard', payload.nextAccountId);
        return;
      }

      await createClient()
        .auth.signOut({ scope: 'local' })
        .catch(() => {});
      // Clear the authenticated tree after destructive organization removal.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    } catch (error) {
      console.error('[OrganizationDangerZone] delete failed:', error);
      toast.error('Could not reach the server');
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2">
          <AlertTriangle className="size-4" />
          Delete organization
        </CardTitle>
        <CardDescription>
          Permanently erase{' '}
          <span className="text-foreground font-medium">
            {organizationName}
          </span>
          , all {branches.length} branches, contacts, conversations,
          memberships, payments, integrations, audit history, and stored media.
          Teammates who only belong here lose their login.
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <Button
          variant="destructive"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => {
            setTyped('');
            setOpen(true);
          }}
        >
          <Trash2 className="size-4" />
          Delete organization
        </Button>
      </CardFooter>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {organizationName}?</DialogTitle>
            <DialogDescription>
              This permanently deletes every branch and all organization data.
              It cannot be undone or restored from UsefulDesk.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-organization-confirm">
              Type {organizationName} to confirm
            </Label>
            <Input
              id="delete-organization-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder={organizationName}
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
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  Permanently delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
