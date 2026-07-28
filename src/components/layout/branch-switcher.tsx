'use client';

import { useState } from 'react';
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function BranchSwitcher({ collapsed }: { collapsed: boolean }) {
  const {
    account,
    branches,
    switchBranch,
    isOrganizationOwner,
    organizationId,
  } = useAuth();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!account || branches.length === 0) return null;

  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          aria-label={`Current branch: ${account.name}`}
          className={cn(
            'w-full justify-start',
            collapsed && 'lg:size-10 lg:justify-center lg:px-0'
          )}
        />
      }
    >
      <Building2 className="size-4 shrink-0" />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left',
          collapsed && 'lg:hidden'
        )}
      >
        {account.name}
      </span>
      <ChevronsUpDown
        className={cn('size-4 shrink-0', collapsed && 'lg:hidden')}
      />
    </DropdownMenuTrigger>
  );

  const legalEntities = Array.from(
    new Map(
      branches.map((branch) => [
        branch.legal_entity_id,
        {
          id: branch.legal_entity_id,
          name: branch.legal_entity_name,
        },
      ])
    ).values()
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip disabled={!collapsed}>
          <TooltipTrigger delay={350} render={trigger} />
          <TooltipContent side="right" sideOffset={8}>
            Switch branch · {account.name}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          side={collapsed ? 'right' : 'bottom'}
          sideOffset={6}
          className="min-w-72"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Branches</DropdownMenuLabel>
            {branches.map((branch) => {
              const selected = branch.account_id === account.id;
              const archived = branch.branch_status === 'archived';
              const loading = switchingTo === branch.account_id;
              return (
                <DropdownMenuItem
                  key={branch.account_id}
                  disabled={archived || switchingTo !== null}
                  onClick={async () => {
                    if (selected || archived) return;
                    setSwitchingTo(branch.account_id);
                    try {
                      await switchBranch(branch.account_id);
                    } catch (error) {
                      console.error('[BranchSwitcher] switch failed:', error);
                      toast.error('Could not switch branch');
                      setSwitchingTo(null);
                    }
                  }}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Building2 className="size-4" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {branch.account_name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {branch.organization_name} · {branch.role}
                      {archived
                        ? ' · Archived'
                        : branch.readiness_state !== 'ready'
                          ? ` · ${branch.readiness_state}`
                          : ''}
                    </span>
                  </span>
                  {selected ? <Check className="size-4" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {isOrganizationOwner ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  setBranchName('');
                  setLegalEntityId(account.legal_entity_id);
                  setCreateOpen(true);
                }}
              >
                <Plus className="size-4" />
                Add branch
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add branch</DialogTitle>
            <DialogDescription>
              Creates an isolated branch with setup readiness. WhatsApp,
              Razorpay, UPI, API keys, and webhook credentials are never copied.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                creating ||
                !organizationId ||
                !legalEntityId ||
                !branchName.trim()
              ) {
                return;
              }
              setCreating(true);
              try {
                const response = await fetch('/api/branches', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: branchName.trim(),
                    legalEntityId,
                  }),
                });
                const payload = (await response.json().catch(() => ({}))) as {
                  accountId?: string;
                  error?: string;
                };
                if (!response.ok || !payload.accountId) {
                  throw new Error(payload.error || 'Could not create branch');
                }
                toast.success('Branch created');
                await switchBranch(payload.accountId);
              } catch (error) {
                console.error('[BranchSwitcher] create failed:', error);
                toast.error(
                  error instanceof Error
                    ? error.message
                    : 'Could not create branch'
                );
                setCreating(false);
              }
            }}
          >
            <div className="space-y-2">
              <label htmlFor="new-branch-name" className="text-sm font-medium">
                Branch name
              </label>
              <Input
                id="new-branch-name"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                maxLength={80}
                placeholder="Koramangala"
                autoFocus
                disabled={creating}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Legal entity</label>
              <Select
                value={legalEntityId}
                onValueChange={(value) => setLegalEntityId(value)}
                disabled={creating}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select legal entity" />
                </SelectTrigger>
                <SelectContent>
                  {legalEntities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating || !branchName.trim() || !legalEntityId}
              >
                {creating ? <Loader2 className="size-4 animate-spin" /> : null}
                Create branch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
