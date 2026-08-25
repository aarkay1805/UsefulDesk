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

type MembershipActionId =
  | 'renew'
  | 'change-plan'
  | 'edit'
  | 'freeze'
  | 'resume'
  | 'cancel'
  | 'reactivate';

const ACTION_LABEL: Record<MembershipActionId, string> = {
  renew: 'Renew membership',
  'change-plan': 'Change plan',
  edit: 'Edit membership',
  freeze: 'Freeze membership',
  resume: 'Resume membership',
  cancel: 'Cancel membership',
  reactivate: 'Reactivate membership',
};

function actionIsApplicable(
  actionId: MembershipActionId,
  status: MembershipStatus,
  isTrial: boolean
) {
  switch (actionId) {
    case 'renew':
    case 'change-plan':
      return status === 'active' && !isTrial;
    case 'freeze':
      return status === 'active';
    case 'resume':
      return status === 'frozen';
    case 'reactivate':
      return status === 'cancelled';
    case 'cancel':
      return status !== 'cancelled';
    case 'edit':
      return true;
  }
}

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
  const [selectedActionId, setSelectedActionId] =
    useState<MembershipActionId | null>(null);
  const [blockerOpen, setBlockerOpen] = useState(false);

  const selectedActionApplicable = selectedActionId
    ? actionIsApplicable(selectedActionId, status, isTrial)
    : false;
  const blocker: ActionBlocker | null =
    selectedActionId && selectedActionApplicable
      ? !canManage
        ? {
            title: 'Admin access required',
            description: `Ask an admin or owner to ${ACTION_LABEL[selectedActionId].toLowerCase()}.`,
          }
        : lifecycleBlockReason
          ? {
              title: 'AutoPay must be resolved first',
              description: lifecycleBlockReason,
              resolution: {
                label: 'Open billing',
                onResolve: onOpenBilling,
              },
            }
          : null
      : null;

  function runOrExplain(actionId: MembershipActionId, action: () => void) {
    setMenuOpen(false);
    if (!canManage || lifecycleBlockReason) {
      setSelectedActionId(actionId);
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
          if (!nextOpen) setSelectedActionId(null);
        }}
        align="end"
      />
      <DropdownMenuContent align="end" className="min-w-52">
        {status === 'active' && !isTrial && (
          <DropdownMenuItem onClick={() => runOrExplain('renew', onRenew)}>
            <RefreshCw className="size-4" /> Renew membership
          </DropdownMenuItem>
        )}
        {status === 'active' && !isTrial && (
          <DropdownMenuItem
            onClick={() => runOrExplain('change-plan', onChangePlan)}
          >
            <ArrowLeftRight className="size-4" /> Change plan
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => runOrExplain('edit', onEdit)}>
          <Pencil className="size-4" /> Edit membership
        </DropdownMenuItem>
        {status === 'frozen' ? (
          <DropdownMenuItem
            onClick={() => runOrExplain('resume', onResume)}
            disabled={busy}
          >
            <Play className="size-4" /> Resume membership
          </DropdownMenuItem>
        ) : (
          status === 'active' && (
            <DropdownMenuItem
              onClick={() => runOrExplain('freeze', onFreeze)}
              disabled={busy}
            >
              <Snowflake className="size-4" /> Freeze membership
            </DropdownMenuItem>
          )
        )}
        {status === 'cancelled' ? (
          <DropdownMenuItem
            onClick={() => runOrExplain('reactivate', onReactivate)}
            disabled={busy}
          >
            <RotateCcw className="size-4" /> Reactivate membership
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => runOrExplain('cancel', onCancel)}
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
