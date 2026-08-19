'use client';

import { Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/ui/user-avatar';
import { FollowUpButton } from '@/components/follow-ups/follow-up-button';
import {
  SendReminderButton,
  type ReminderReadiness,
} from '@/components/members/send-reminder-button';
import { branchHref } from '@/lib/auth/branch-context';
import type { Membership } from '@/types';

type MembersView =
  | 'renewals'
  | 'followups'
  | 'trials'
  | 'payments'
  | 'retention'
  | 'all'
  | 'attendance';

interface MemberAvatarQuickViewProps {
  membership: Membership;
  readiness: ReminderReadiness;
  canFollowUp?: boolean;
  onSelect: () => void;
  onFollowUp?: () => void;
  onReminderSent?: () => void;
}

interface BuildMemberAvatarPreviewOptions extends MemberAvatarQuickViewProps {
  accountId: string | null;
  view: MembersView;
}

function MemberAvatarQuickView({
  membership,
  readiness,
  canFollowUp = false,
  onSelect,
  onFollowUp,
  onReminderSent,
}: MemberAvatarQuickViewProps) {
  const name = membership.contact?.name?.trim() || 'Unnamed';

  return (
    <div
      className="flex flex-col gap-2.5"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-col items-center gap-2 py-1">
        <UserAvatar
          name={name}
          src={membership.contact?.avatar_url}
          className="size-36"
          fallbackClassName="text-4xl"
        />
        <div className="min-w-0 text-center">
          <p className="font-heading text-foreground truncate text-base font-medium">
            {name}
          </p>
          <p className="text-muted-foreground text-xs">
            Member ID{' '}
            <span className="font-mono tabular-nums">
              {membership.member_number}
            </span>
          </p>
        </div>
      </div>
      <Separator />
      <div className="flex items-center justify-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onSelect}>
          <Eye className="size-3.5" />
          Details
        </Button>
        <SendReminderButton
          membership={membership}
          readiness={readiness}
          onSent={onReminderSent}
        />
        {onFollowUp ? (
          <FollowUpButton canAct={canFollowUp} onClick={onFollowUp} />
        ) : null}
      </div>
    </div>
  );
}

export function buildMemberAvatarPreview({
  membership,
  accountId,
  view,
  readiness,
  canFollowUp,
  onSelect,
  onFollowUp,
  onReminderSent,
}: BuildMemberAvatarPreviewOptions) {
  return {
    href: branchHref(
      `/members?view=${view}&member=${membership.id}`,
      accountId
    ),
    onNavigate: onSelect,
    content: (
      <MemberAvatarQuickView
        membership={membership}
        readiness={readiness}
        canFollowUp={canFollowUp}
        onSelect={onSelect}
        onFollowUp={onFollowUp}
        onReminderSent={onReminderSent}
      />
    ),
  };
}
