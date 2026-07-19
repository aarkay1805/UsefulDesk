'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { remindAtInTz } from '@/lib/leads/follow-up-dates';
import { defaultReason } from '@/lib/memberships/follow-ups';
import {
  DEFAULT_FOLLOW_UP_DRAFT,
  FollowUpFields,
  resolveDueDate,
  type FollowUpDraft,
} from '@/components/follow-ups/follow-up-fields';
import type { FollowUpReason, Membership } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAccountStaff } from './use-account-staff';

interface FollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Member the task chases — supplies contact/membership context. */
  membership: Membership;
  /** Pre-select a reason (e.g. 'inactive' from the retention lists);
   *  defaults to one derived from the membership's state. */
  initialReason?: FollowUpReason;
  onSaved: () => void;
}

/** Create a member follow-up using the shared follow-up fields. */
export function FollowUpDialog({
  open,
  onOpenChange,
  membership,
  initialReason,
  onSaved,
}: FollowUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <AssignForm
            membership={membership}
            initialReason={initialReason}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({
  membership,
  initialReason,
  onClose,
  onSaved,
}: {
  membership: Membership;
  initialReason?: FollowUpReason;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const { locale, fmt } = useLocale();
  const { staff } = useAccountStaff();

  // Renewal/retention assignment defaults to tomorrow while note-created
  // tasks retain the shared composer's three-day default.
  const [draft, setDraft] = useState<FollowUpDraft>(() => ({
    ...DEFAULT_FOLLOW_UP_DRAFT,
    enabled: true,
    reason: initialReason ?? defaultReason(membership, fmt.today()),
    dueId: 'tomorrow',
    assignee: user?.id ?? '',
  }));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAssign() {
    if (!user) return;
    const dueDate = resolveDueDate(draft, fmt.today());
    if (!dueDate) return toast.error('Pick a due date');

    setSaving(true);
    const { error } = await supabase.from('follow_ups').insert({
      account_id: membership.account_id,
      contact_id: membership.contact_id,
      membership_id: membership.id,
      assigned_to: draft.assignee || user.id,
      created_by: user.id,
      reason: draft.reason,
      task_type: draft.type,
      due_date: dueDate,
      remind_at: draft.remindSlot
        ? remindAtInTz(dueDate, draft.remindSlot, locale.timeZone)
        : null,
      note: note.trim() || null,
    });
    setSaving(false);

    if (error) {
      if (isUniqueViolation(error)) {
        toast.error('This member already has an open follow-up.');
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success('Follow-up created');
    onClose();
    onSaved();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create follow-up</DialogTitle>
        <DialogDescription>
          Schedule a follow-up for{' '}
          {membership.contact?.name || 'this member'}, with an owner and
          reminder.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <FollowUpFields
          draft={draft}
          onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          staff={staff}
          currentUserId={user?.id ?? ''}
          showEnabledToggle={false}
        />

        <div className="space-y-1.5">
          <Label htmlFor="fu-note" size="sm">
            Note <span className="opacity-60">(optional)</span>
          </Label>
          <Textarea
            id="fu-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Promised to decide after salary day"
            className="min-h-[60px] resize-none text-sm"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleAssign} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Create follow-up
        </Button>
      </DialogFooter>
    </>
  );
}
