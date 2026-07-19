'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import {
  LEAD_FOLLOW_UP_OUTCOMES,
  MEMBER_FOLLOW_UP_OUTCOMES,
  OUTCOME_LABEL,
} from '@/lib/memberships/follow-ups';
import type { Contact, FollowUpOutcome } from '@/types';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type FollowUpContext = 'lead' | 'member';

export interface FollowUpCompletionTarget {
  id: string;
  contact_id?: string;
  membership_id?: string | null;
  note?: string | null;
  contact?: Pick<Contact, 'name'>;
  status?: 'open' | 'done' | 'cancelled';
}

const LEAD_OUTCOME_LABEL: Partial<Record<FollowUpOutcome, string>> = {
  contacted: 'Contacted',
  trial_booked: 'Trial booked',
  promised: 'Asked for more time',
  no_answer: 'No answer',
  not_interested: 'Not interested',
  other: 'Other',
};

function outcomeOptions(context: FollowUpContext): FollowUpOutcome[] {
  return Array.from(
    context === 'lead' ? LEAD_FOLLOW_UP_OUTCOMES : MEMBER_FOLLOW_UP_OUTCOMES
  );
}

function outcomeLabel(
  outcome: FollowUpOutcome,
  context: FollowUpContext
): string {
  return context === 'lead'
    ? (LEAD_OUTCOME_LABEL[outcome] ?? OUTCOME_LABEL[outcome])
    : OUTCOME_LABEL[outcome];
}

interface CompleteFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp: FollowUpCompletionTarget;
  context?: FollowUpContext;
  onSaved: (status: 'done' | 'cancelled') => void;
}

/** Close one lead/member task only after the staff member records an outcome. */
export function CompleteFollowUpDialog({
  open,
  onOpenChange,
  followUp,
  context = followUp.membership_id ? 'member' : 'lead',
  onSaved,
}: CompleteFollowUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <CompleteForm
            followUp={followUp}
            context={context}
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
  context?: FollowUpContext;
  onSaved: (status: 'done' | 'cancelled') => void;
}

/** Complete or cancel selected lead/member follow-ups in one explicit action. */
export function BulkCompleteFollowUpsDialog({
  open,
  onOpenChange,
  followUpIds,
  context = 'member',
  onSaved,
}: BulkCompleteFollowUpsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && (
          <BulkCompleteForm
            followUpIds={followUpIds}
            context={context}
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
  context,
  onClose,
  onSaved,
}: {
  followUpIds: string[];
  context: FollowUpContext;
  onClose: () => void;
  onSaved: (status: 'done' | 'cancelled') => void;
}) {
  const supabase = createClient();
  const [outcome, setOutcome] = useState<FollowUpOutcome>(
    () => outcomeOptions(context)[0]
  );
  const [saving, setSaving] = useState(false);

  async function close(status: 'done' | 'cancelled') {
    if (followUpIds.length === 0) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('follow_ups')
      .update({
        status,
        outcome: status === 'done' ? outcome : null,
        completed_at: new Date().toISOString(),
      })
      .in('id', followUpIds)
      .eq('status', 'open')
      .select('id');
    setSaving(false);

    if (error) {
      toast.error(getErrorMessage(error, 'Failed to update follow-ups'));
      return;
    }
    if (!data || data.length !== followUpIds.length) {
      toast.error(
        'Some follow-ups could not be updated. Refresh and try again.'
      );
      return;
    }
    const noun = `follow-up${followUpIds.length === 1 ? '' : 's'}`;
    toast.success(
      status === 'done'
        ? `${followUpIds.length} ${noun} completed`
        : `${followUpIds.length} ${noun} cancelled`
    );
    onClose();
    onSaved(status);
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
        <Label htmlFor="bulk-fu-outcome" size="sm">
          Outcome
        </Label>
        <Select
          value={outcome}
          onValueChange={(value) =>
            value && setOutcome(value as FollowUpOutcome)
          }
        >
          <SelectTrigger id="bulk-fu-outcome" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outcomeOptions(context).map((option) => (
              <SelectItem key={option} value={option}>
                {outcomeLabel(option, context)}
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
  context,
  onClose,
  onSaved,
}: {
  followUp: FollowUpCompletionTarget;
  context: FollowUpContext;
  onClose: () => void;
  onSaved: (status: 'done' | 'cancelled') => void;
}) {
  const supabase = createClient();
  const options = outcomeOptions(context);
  const [outcome, setOutcome] = useState<FollowUpOutcome>(options[0]);
  const existingNote = followUp.note?.trim() ?? '';
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function close(status: 'done' | 'cancelled') {
    setSaving(true);
    const { data, error } = await supabase
      .from('follow_ups')
      .update({
        status,
        outcome: status === 'done' ? outcome : null,
        note: note.trim() || existingNote || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', followUp.id)
      .eq('status', 'open')
      .select('id')
      .maybeSingle();
    setSaving(false);

    if (error || !data) {
      toast.error(
        getErrorMessage(error, 'This follow-up could not be updated')
      );
      return;
    }
    toast.success(
      status === 'done' ? 'Follow-up completed' : 'Follow-up cancelled'
    );
    onClose();
    onSaved(status);
  }

  const personLabel = followUp.contact?.name?.trim() || `this ${context}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Complete follow-up</DialogTitle>
        <DialogDescription>
          Record what happened with {personLabel}.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fu-outcome" size="sm">
            Outcome
          </Label>
          <Select
            value={outcome}
            onValueChange={(value) =>
              value && setOutcome(value as FollowUpOutcome)
            }
          >
            <SelectTrigger id="fu-outcome" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {outcomeLabel(option, context)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fu-close-note" size="sm">
            Note <span className="opacity-60">(optional)</span>
          </Label>
          <Textarea
            id="fu-close-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              existingNote ||
              (context === 'lead'
                ? 'e.g. Interested in the evening batch; asked to call Friday'
                : 'e.g. Renewed for 3 months, paid via UPI')
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
