'use client';

import { useState } from 'react';

import { MemberDetailView } from '@/components/members/member-detail-view';
import { MemberForm } from '@/components/members/member-form';
import { useReminderReadiness } from '@/components/members/send-reminder-button';
import type { Membership } from '@/types';

export function FinanceMemberDetailSheet({
  membershipId,
  onOpenChange,
  onChanged,
}: {
  membershipId: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const readiness = useReminderReadiness();
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Membership | null>(null);

  const handleMemberChanged = () => {
    setReloadKey((value) => value + 1);
    onChanged();
  };

  return (
    <>
      <MemberDetailView
        membershipId={membershipId}
        open
        reloadKey={reloadKey}
        onOpenChange={onOpenChange}
        readiness={readiness}
        onChanged={handleMemberChanged}
        onEdit={setEditing}
      />
      <MemberForm
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        member={editing}
        onSaved={handleMemberChanged}
      />
    </>
  );
}
