'use client';

import { useState } from 'react';
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { BranchCreationDialog } from '@/components/branches/branch-creation-dialog';
import { Button } from '@/components/ui/button';
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
  const { account, branches, switchBranch, isOrganizationOwner } = useAuth();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (!account || branches.length === 0) return null;

  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="outline"
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
                      {archived ? ' · Archived' : ''}
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

      <BranchCreationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
