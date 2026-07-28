'use client';

import { useState } from 'react';
import {
  Archive,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth, type BranchAccount } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { branchHref } from '@/lib/auth/branch-context';
import { canManageBranchLifecycle } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type BranchAction = 'archive' | 'restore' | 'delete';

interface BranchActionsProps {
  branch: BranchAccount;
  selected: boolean;
}

export function BranchActions({ branch, selected }: BranchActionsProps) {
  const { branches } = useAuth();
  const canManageOrganization = useCan('manage-organization');
  const canManageBranch =
    canManageOrganization &&
    canManageBranchLifecycle(
      branch.is_organization_owner ? 'owner' : null,
      branch.role
    );
  const [action, setAction] = useState<BranchAction | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canManageBranch) return null;

  const archived = branch.branch_status === 'archived';
  const requiresName = action === 'archive' || action === 'delete';
  const confirmed = !requiresName || typed === branch.account_name;

  function openAction(nextAction: BranchAction) {
    setTyped('');
    setAction(nextAction);
  }

  function closeDialog() {
    if (busy) return;
    setAction(null);
    setTyped('');
  }

  async function handleAction() {
    if (!action || !confirmed || busy) return;
    setBusy(true);

    try {
      const deleting = action === 'delete';
      const response = await fetch(
        `/api/organization/branches/${branch.account_id}`,
        {
          method: deleting ? 'DELETE' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            deleting
              ? { confirm: typed }
              : {
                  action,
                  ...(action === 'archive' ? { confirm: typed } : {}),
                }
          ),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        nextAccountId?: string | null;
        warningCount?: number;
      };
      if (!response.ok) {
        toast.error(payload.error || `Failed to ${action} the branch`);
        setBusy(false);
        return;
      }

      if (action === 'archive') toast.success('Branch archived');
      if (action === 'restore') toast.success('Branch restored');
      if (action === 'delete') {
        if (payload.warningCount) {
          toast.warning(
            'Branch deleted, but some unused teammate logins need administrator cleanup.'
          );
        } else {
          toast.success('Branch permanently deleted');
        }
      }

      if (selected && (action === 'archive' || action === 'delete')) {
        const nextAccountId =
          payload.nextAccountId ??
          branches.find(
            (candidate) =>
              candidate.account_id !== branch.account_id &&
              candidate.branch_status === 'active'
          )?.account_id;
        window.location.href = nextAccountId
          ? branchHref('/settings?tab=organization', nextAccountId)
          : '/dashboard';
        return;
      }

      window.location.reload();
    } catch (error) {
      console.error('[BranchActions] lifecycle action failed:', error);
      toast.error('Could not reach the server');
      setBusy(false);
    }
  }

  const title =
    action === 'archive'
      ? `Archive ${branch.account_name}?`
      : action === 'restore'
        ? `Restore ${branch.account_name}?`
        : `Delete ${branch.account_name}?`;
  const description =
    action === 'archive'
      ? 'This branch becomes unavailable for operational work. Its contacts, messages, memberships, payments, and finance history are retained.'
      : action === 'restore'
        ? 'This branch becomes active again. Review its connections and readiness before resuming operational work.'
        : 'This permanently deletes the branch, including its contacts, conversations, memberships, payments, integrations, audit-linked data, and stored media. This cannot be undone.';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Manage ${branch.account_name}`}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {archived ? (
            <DropdownMenuItem onClick={() => openAction('restore')}>
              <RotateCcw className="size-4" />
              Restore branch
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => openAction('archive')}>
              <Archive className="size-4" />
              Archive branch
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => openAction('delete')}
          >
            <Trash2 className="size-4" />
            Delete branch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={action !== null} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {requiresName ? (
            <div className="space-y-2">
              <Label htmlFor={`branch-${action}-confirm`}>
                Type {branch.account_name} to confirm
              </Label>
              <Input
                id={`branch-${action}-confirm`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                placeholder={branch.account_name}
                disabled={busy}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={action === 'delete' ? 'destructive' : 'default'}
              onClick={handleAction}
              disabled={!confirmed || busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy
                ? action === 'restore'
                  ? 'Restoring…'
                  : action === 'archive'
                    ? 'Archiving…'
                    : 'Deleting…'
                : action === 'restore'
                  ? 'Restore branch'
                  : action === 'archive'
                    ? 'Archive branch'
                    : 'Permanently delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
