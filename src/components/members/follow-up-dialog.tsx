'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { remindAtInTz } from '@/lib/leads/follow-up-dates';
import { defaultReason, OUTCOME_LABEL } from '@/lib/memberships/follow-ups';
import {
  DEFAULT_FOLLOW_UP_DRAFT,
  FollowUpFields,
  resolveDueDate,
  type FollowUpDraft,
} from '@/components/follow-ups/follow-up-fields';
import type {
  FollowUp,
  FollowUpOutcome,
  FollowUpReason,
  Membership,
} from '@/types';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAccountStaff } from './use-account-staff';

const OUTCOMES = Object.keys(OUTCOME_LABEL) as FollowUpOutcome[];

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

/**
 * Create a follow-up with the same fields used by the notes composer.
 * The form body mounts fresh each open, so field state initializes per
 * member without an on-open reset effect (repo lint forbids setState
 * directly in effects).
 */
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
          Set {membership.contact?.name || 'this member'}&apos;s next action,
          owner, and reminder.
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
          <Label htmlFor="fu-note" className="text-muted-foreground">
            Note <span className="opacity-60">(optional)</span>
          </Label>
          <Textarea
            id="fu-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
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

interface CompleteFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp: FollowUp;
  onSaved: () => void;
}

/** Close a follow-up with an outcome — or cancel the task entirely. */
export function CompleteFollowUpDialog({
  open,
  onOpenChange,
  followUp,
  onSaved,
}: CompleteFollowUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <CompleteForm
            followUp={followUp}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BulkCompleteFollowUpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUpIds: string[];
  onSaved: () => void;
}

/** Complete or cancel every selected open follow-up in one explicit action. */
export function BulkCompleteFollowUpsDialog({
  open,
  onOpenChange,
  followUpIds,
  onSaved,
}: BulkCompleteFollowUpsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <BulkCompleteForm
            followUpIds={followUpIds}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkCompleteForm({
  followUpIds,
  onClose,
  onSaved,
}: {
  followUpIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [outcome, setOutcome] = useState<FollowUpOutcome>('renewed');
  const [saving, setSaving] = useState(false);

  async function close(status: 'done' | 'cancelled') {
    if (followUpIds.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from('follow_ups')
      .update({
        status,
        outcome: status === 'done' ? outcome : null,
        completed_at: new Date().toISOString(),
      })
      .in('id', followUpIds)
      .eq('status', 'open');
    setSaving(false);

    if (error) return toast.error(error.message);
    const noun = `follow-up${followUpIds.length === 1 ? '' : 's'}`;
    toast.success(
      status === 'done'
        ? `${followUpIds.length} ${noun} completed`
        : `${followUpIds.length} ${noun} cancelled`
    );
    onClose();
    onSaved();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Complete selected follow-ups</DialogTitle>
        <DialogDescription>
          Apply one outcome to {followUpIds.length} selected follow-up
          {followUpIds.length === 1 ? '' : 's'}. Existing task notes are
          preserved.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="bulk-fu-outcome" className="text-muted-foreground">
          Outcome
        </Label>
        <Select
          value={outcome}
          onValueChange={(value) => setOutcome(value as FollowUpOutcome)}
        >
          <SelectTrigger id="bulk-fu-outcome" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOMES.map((option) => (
              <SelectItem key={option} value={option}>
                {OUTCOME_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => close('cancelled')}
          disabled={saving}
        >
          Cancel tasks
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button type="button" onClick={() => close('done')} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Mark done
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function CompleteForm({
  followUp,
  onClose,
  onSaved,
}: {
  followUp: FollowUp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();

  const [outcome, setOutcome] = useState<FollowUpOutcome>('renewed');
  const existingNote = followUp.note?.trim() ?? '';
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function close(status: 'done' | 'cancelled') {
    setSaving(true);
    const { error } = await supabase
      .from('follow_ups')
      .update({
        status,
        outcome: status === 'done' ? outcome : null,
        note: note.trim() || existingNote || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', followUp.id);
    setSaving(false);

    if (error) return toast.error(error.message);
    toast.success(
      status === 'done' ? 'Follow-up completed' : 'Follow-up cancelled'
    );
    onClose();
    onSaved();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Complete follow-up</DialogTitle>
        <DialogDescription>
          What happened with {followUp.contact?.name || 'this member'}?
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fu-outcome" className="text-muted-foreground">
            Outcome
          </Label>
          <Select
            value={outcome}
            onValueChange={(v) => setOutcome(v as FollowUpOutcome)}
          >
            <SelectTrigger id="fu-outcome" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fu-close-note" className="text-muted-foreground">
            Note <span className="opacity-60">(optional)</span>
          </Label>
          <Textarea
            id="fu-close-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              existingNote || 'e.g. Renewed for 3 months, paid via UPI'
            }
            className="min-h-[60px] resize-none text-sm"
          />
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => close('cancelled')}
          disabled={saving}
        >
          Cancel task
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button type="button" onClick={() => close('done')} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Mark done
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
