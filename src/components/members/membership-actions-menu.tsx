'use client';

import { useState } from 'react';
import {
  ArrowLeftRight,
  Ban,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Snowflake,
} from 'lucide-react';

import type { MembershipStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';

interface MembershipActionsMenuProps {
  status: MembershipStatus;
  isTrial: boolean;
  canManage: boolean;
  lifecycleBlockReason: string | null;
  busy: boolean;
  onRenew: () => void;
  onChangePlan: () => void;
  onEdit: () => void;
  onFreeze: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReactivate: () => void;
  onOpenBilling: () => void;
}

export function MembershipActionsMenu({
  status,
  isTrial,
  canManage,
  lifecycleBlockReason,
  busy,
  onRenew,
  onChangePlan,
  onEdit,
  onFreeze,
  onResume,
  onCancel,
  onReactivate,
  onOpenBilling,
}: MembershipActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [blocker, setBlocker] = useState<ActionBlocker | null>(null);
  const [blockerOpen, setBlockerOpen] = useState(false);

  function runOrExplain(label: string, action: () => void) {
    setMenuOpen(false);
    if (!canManage) {
      setBlocker({
        title: 'Admin access required',
        description: `Ask an admin or owner to ${label.toLowerCase()}.`,
      });
      setBlockerOpen(true);
      return;
    }
    if (lifecycleBlockReason) {
      setBlocker({
        title: 'AutoPay must be resolved first',
        description: lifecycleBlockReason,
        resolution: { label: 'Open billing', onResolve: onOpenBilling },
      });
      setBlockerOpen(true);
      return;
    }
    action();
  }

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen) {
          setMenuOpen(false);
        } else if (!blocker && eventDetails.event.type === 'keydown') {
          setMenuOpen(true);
        }
      }}
    >
      <ResolvableAction
        trigger={
          <DropdownMenuTrigger
            nativeButton={false}
            render={
              <Button
                nativeButton={false}
                render={<div />}
                variant="ghost"
                size="icon-sm"
                aria-label="Membership actions"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
        }
        onAction={() => setMenuOpen(true)}
        blocker={blocker}
        open={blockerOpen}
        onOpenChange={(nextOpen) => {
          setBlockerOpen(nextOpen);
          if (!nextOpen) setBlocker(null);
        }}
        align="end"
      />
      <DropdownMenuContent align="end" className="min-w-52">
        {status === 'active' && !isTrial && (
          <DropdownMenuItem
            onClick={() => runOrExplain('Renew membership', onRenew)}
          >
            <RefreshCw className="size-4" /> Renew membership
          </DropdownMenuItem>
        )}
        {status === 'active' && !isTrial && (
          <DropdownMenuItem
            onClick={() => runOrExplain('Change plan', onChangePlan)}
          >
            <ArrowLeftRight className="size-4" /> Change plan
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => runOrExplain('Edit membership', onEdit)}
        >
          <Pencil className="size-4" /> Edit membership
        </DropdownMenuItem>
        {status === 'frozen' ? (
          <DropdownMenuItem
            onClick={() => runOrExplain('Resume membership', onResume)}
            disabled={busy}
          >
            <Play className="size-4" /> Resume membership
          </DropdownMenuItem>
        ) : (
          status === 'active' && (
            <DropdownMenuItem
              onClick={() => runOrExplain('Freeze membership', onFreeze)}
              disabled={busy}
            >
              <Snowflake className="size-4" /> Freeze membership
            </DropdownMenuItem>
          )
        )}
        {status === 'cancelled' ? (
          <DropdownMenuItem
            onClick={() => runOrExplain('Reactivate membership', onReactivate)}
            disabled={busy}
          >
            <RotateCcw className="size-4" /> Reactivate membership
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => runOrExplain('Cancel membership', onCancel)}
              disabled={busy}
            >
              <Ban className="size-4" /> Cancel membership
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
