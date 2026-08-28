'use client';

import type { Membership } from '@/types';
import { MemberDetailView } from '@/components/members/member-detail-view';
import { useReminderReadiness } from '@/components/members/send-reminder-button';

/** WhatsApp readiness and the full member sheet load only after selection. */
export function DashboardMemberDetail({
  membershipId,
  reloadKey,
  onClose,
  onChanged,
  onEdit,
}: {
  membershipId: string;
  reloadKey: number;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (membership: Membership) => void;
}) {
  const readiness = useReminderReadiness();
  return (
    <MemberDetailView
      membershipId={membershipId}
      open
      reloadKey={reloadKey}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      readiness={readiness}
      onChanged={onChanged}
      onEdit={onEdit}
    />
  );
}
