'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { getErrorMessage } from '@/lib/errors';
import {
  defaultManualFollowUpReason,
  manualFollowUpReasonForWrite,
} from '@/lib/follow-ups/manual';
import { followUpDueState } from '@/lib/follow-ups/due-state';
import { remindAtInTz } from '@/lib/leads/follow-up-dates';
import { createClient } from '@/lib/supabase/client';
import type { FollowUp, FollowUpReason, Membership } from '@/types';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CompleteFollowUpDialog } from './complete-follow-up-dialog';
import { FollowUpComposer } from './follow-up-composer';
import { FollowUpTaskSummary } from './follow-up-task-summary';
import {
  DEFAULT_FOLLOW_UP_DRAFT,
  resolveDueDate,
  type FollowUpDraft,
} from './follow-up-fields';

/** The recovery a rejected create always names. */
const ONE_OPEN_TASK =
  'Only one open follow-up at a time — complete the current one first.';

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

/** The contact's existing open task, when the accountability rule blocks a new one. */
type OpenFollowUp = Pick<
  FollowUp,
  'id' | 'task_type' | 'due_date' | 'note' | 'membership_id' | 'reason'
>;

/** The canonical standalone creator used by every lead/member row action. */
export function FollowUpDialog(props: FollowUpDialogProps) {
  const membership = props.membership;
  const contactId = membership ? membership.contact_id : props.contactId;
  const contactName = membership?.contact?.name ?? props.contactName;
  const context = membership ? 'member' : 'lead';

  // Completing the blocking task swaps this dialog for the canonical
  // completion one — two siblings, never a dialog inside a dialog.
  const [completing, setCompleting] = useState<OpenFollowUp | null>(null);

  function dismiss() {
    setCompleting(null);
    props.onOpenChange(false);
  }

  return (
    <>
      <Dialog
        open={props.open && !completing}
        onOpenChange={(open) => !open && dismiss()}
      >
        {/* The note textarea grows with its content, so the body
            scrolls on a short viewport instead of the dialog running
            off it — the same recipe invoice-detail-dialog uses. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-md">
          {props.open && !completing && (
            <CreateFollowUpForm
              contactId={contactId}
              contactName={contactName}
              membership={membership}
              initialReason={props.initialReason}
              onClose={() => props.onOpenChange(false)}
              onSaved={props.onSaved}
              onComplete={setCompleting}
            />
          )}
        </DialogContent>
      </Dialog>

      {completing && (
        <CompleteFollowUpDialog
          open
          // Back / Escape returns to the "already open" state it came
          // from; only completing the task or closing that state leaves.
          onOpenChange={(open) => !open && setCompleting(null)}
          followUp={{
            id: completing.id,
            contact_id: contactId,
            membership_id: completing.membership_id,
            note: completing.note,
            contact: contactName ? { name: contactName } : undefined,
          }}
          context={context}
          onSaved={() => {
            dismiss();
            props.onSaved();
          }}
        />
      )}
    </>
  );
}

function CreateFollowUpForm({
  contactId,
  contactName,
  membership,
  initialReason,
  onClose,
  onSaved,
  onComplete,
}: {
  contactId: string;
  contactName?: string;
  membership?: Membership;
  initialReason?: FollowUpReason;
  onClose: () => void;
  onSaved: () => void;
  onComplete: (followUp: OpenFollowUp) => void;
}) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const { locale, fmt } = useLocale();
  const { staff } = useAccountStaff();
  const context = membership ? 'member' : 'lead';
  const personLabel = contactName?.trim() || `this ${context}`;

  // Seeded from the shared default, exactly like the profile composer —
  // the only per-surface seed is the member Reason, which the calling
  // worklist knows and the composer cannot infer.
  const [draft, setDraft] = useState<FollowUpDraft>(() => ({
    ...DEFAULT_FOLLOW_UP_DRAFT,
    enabled: true,
    reason: defaultManualFollowUpReason(membership, initialReason, fmt.today()),
  }));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Only one OPEN follow-up per contact exists (partial unique index in
  // migration 036). Reading it when the dialog opens turns a rejected
  // submit into an answer the user gets before typing anything.
  const [checking, setChecking] = useState(true);
  const [blocking, setBlocking] = useState<OpenFollowUp | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('follow_ups')
        .select('id, task_type, due_date, note, membership_id, reason')
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .maybeSingle();
      if (cancelled) return;
      setBlocking((data as OpenFollowUp | null) ?? null);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, contactId]);

  async function handleCreate() {
    if (!user) return;
    const dueDate = resolveDueDate(draft, fmt.today());
    if (!dueDate) return toast.error('Pick a due date');

    const followUpAccountId = membership?.account_id ?? accountId;
    if (!followUpAccountId)
      return toast.error(
        'Your session has expired. Sign in again to create this follow-up.'
      );

    setSaving(true);

    // A note written here is a real note: it lands on the person's
    // timeline as `contact_notes` (the profile composer's contract), and
    // the follow-up carries a copy plus the link. Without this the text
    // lived only on the task and was overwritten by the closing note.
    const trimmedNote = note.trim();
    let noteId: string | null = null;
    if (trimmedNote) {
      const { data: insertedNote, error: noteError } = await supabase
        .from('contact_notes')
        .insert({
          contact_id: contactId,
          account_id: followUpAccountId,
          user_id: user.id,
          note_text: trimmedNote,
        })
        .select('id')
        .single();
      if (noteError) {
        setSaving(false);
        toast.error(
          getErrorMessage(
            noteError,
            "Couldn't add the note. Check your connection and try again."
          )
        );
        return;
      }
      noteId = insertedNote?.id ?? null;
    }

    const { error } = await supabase.from('follow_ups').insert({
      account_id: followUpAccountId,
      contact_id: contactId,
      membership_id: membership?.id ?? null,
      note_id: noteId,
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
      note: trimmedNote.slice(0, 200) || null,
    });
    setSaving(false);

    if (error) {
      // The note already saved — say what survived, then the recovery.
      const prefix = trimmedNote ? 'Note added. ' : '';
      if (isUniqueViolation(error)) {
        toast.error(`${prefix}${ONE_OPEN_TASK}`);
      } else {
        toast.error(
          getErrorMessage(
            error,
            `${prefix}The follow-up wasn't created. Try again.`
          )
        );
      }
      return;
    }

    toast.success(
      trimmedNote ? 'Note and follow-up added' : 'Follow-up created'
    );
    onClose();
    onSaved();
  }

  if (checking) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Create follow-up</DialogTitle>
          <DialogDescription>
            Give {personLabel}&apos;s follow-up an owner, a due date, and an
            optional note.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center py-10">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      </>
    );
  }

  if (blocking) {
    const due = followUpDueState('open', blocking.due_date, fmt.today());
    return (
      <>
        <DialogHeader>
          <DialogTitle>Follow-up already open</DialogTitle>
          <DialogDescription>
            {personLabel} already has an open follow-up. {ONE_OPEN_TASK}
          </DialogDescription>
        </DialogHeader>

        <div className="border-border bg-card-2 space-y-2 rounded-lg border p-3">
          <FollowUpTaskSummary
            taskType={blocking.task_type}
            note={blocking.note}
            reason={membership ? blocking.reason : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground text-xs tabular-nums">
              Due {fmt.date(blocking.due_date)}
            </p>
            {due && <Badge variant={due.variant}>{due.label}</Badge>}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={() => onComplete(blocking)}>
            Complete follow-up
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create follow-up</DialogTitle>
        <DialogDescription>
          Give {personLabel}&apos;s follow-up an owner, a due date, and an
          optional note.
        </DialogDescription>
      </DialogHeader>

      {/* The same composer block the profile Notes & follow-ups section
          renders: note first, follow-up fields attached beneath it. Only
          the switch is gone — this dialog IS the follow-up.
          -mx-1/px-1 keeps the composer's 3px focus ring out of the
          scroll container's clip. */}
      <div className="-mx-1 min-h-0 overflow-y-auto px-1 py-1">
        <FollowUpComposer
          text={note}
          onTextChange={setNote}
          onSubmit={handleCreate}
          draft={draft}
          onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          staff={staff}
          currentUserId={user?.id ?? ''}
          showReason={Boolean(membership)}
          showEnabledToggle={false}
          noteLabel="Note (optional)"
          autoFocus
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleCreate} loading={saving}>
          Create follow-up
        </Button>
      </DialogFooter>
    </>
  );
}
