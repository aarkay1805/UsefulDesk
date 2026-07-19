'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { getErrorMessage } from '@/lib/errors';
import {
  defaultManualFollowUpReason,
  manualFollowUpReasonForWrite,
} from '@/lib/follow-ups/manual';
import { remindAtInTz } from '@/lib/leads/follow-up-dates';
import { createClient } from '@/lib/supabase/client';
import type { FollowUpReason, Membership } from '@/types';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_FOLLOW_UP_DRAFT,
  FollowUpFields,
  resolveDueDate,
  type FollowUpDraft,
} from './follow-up-fields';

interface BaseFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

type FollowUpDialogProps = BaseFollowUpDialogProps &
  (
    | {
        /** Member context supplies the membership link and Reason choices. */
        membership: Membership;
        contactId?: never;
        contactName?: never;
        initialReason?: FollowUpReason;
      }
    | {
        /** Lead context is deliberately reason-free in the UI. */
        membership?: never;
        contactId: string;
        contactName?: string;
        initialReason?: never;
      }
  );

/** The canonical standalone creator used by every lead/member row action. */
export function FollowUpDialog(props: FollowUpDialogProps) {
  const membership = props.membership;
  const contactId = membership ? membership.contact_id : props.contactId;
  const contactName = membership?.contact?.name ?? props.contactName;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {props.open && (
          <CreateFollowUpForm
            contactId={contactId}
            contactName={contactName}
            membership={membership}
            initialReason={props.initialReason}
            onClose={() => props.onOpenChange(false)}
            onSaved={props.onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateFollowUpForm({
  contactId,
  contactName,
  membership,
  initialReason,
  onClose,
  onSaved,
}: {
  contactId: string;
  contactName?: string;
  membership?: Membership;
  initialReason?: FollowUpReason;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const { locale, fmt } = useLocale();
  const { staff } = useAccountStaff();
  const context = membership ? 'member' : 'lead';

  // Row-created work defaults to tomorrow. Notes retain the shared
  // composer's three-day default because the note itself adds context.
  const [draft, setDraft] = useState<FollowUpDraft>(() => ({
    ...DEFAULT_FOLLOW_UP_DRAFT,
    enabled: true,
    reason: defaultManualFollowUpReason(membership, initialReason, fmt.today()),
    dueId: 'tomorrow',
    assignee: user?.id ?? '',
  }));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!user) return;
    const dueDate = resolveDueDate(draft, fmt.today());
    if (!dueDate) return toast.error('Pick a due date');

    const followUpAccountId = membership?.account_id ?? accountId;
    if (!followUpAccountId) return toast.error('Not authenticated');

    setSaving(true);
    const { error } = await supabase.from('follow_ups').insert({
      account_id: followUpAccountId,
      contact_id: contactId,
      membership_id: membership?.id ?? null,
      assigned_to: draft.assignee || user.id,
      created_by: user.id,
      // The DB keeps a legacy reason column for all rows. Leads use the
      // neutral sentinel and never expose member-only reason choices.
      reason: manualFollowUpReasonForWrite(Boolean(membership), draft.reason),
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
        toast.error(`This ${context} already has an open follow-up.`);
      } else {
        toast.error(getErrorMessage(error, 'Failed to create follow-up'));
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
          Schedule a follow-up for {contactName || `this ${context}`}, with an
          owner and reminder.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <FollowUpFields
          draft={draft}
          onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          staff={staff}
          currentUserId={user?.id ?? ''}
          showReason={Boolean(membership)}
          showEnabledToggle={false}
        />

        <div className="space-y-1.5">
          <Label htmlFor="follow-up-note" size="sm">
            Note <span className="opacity-60">(optional)</span>
          </Label>
          <Textarea
            id="follow-up-note"
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
        <Button type="button" onClick={handleCreate} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Create follow-up
        </Button>
      </DialogFooter>
    </>
  );
}
