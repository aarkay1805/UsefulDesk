'use client';

// BulkAddNoteDialog — write one note (with an optional follow-up task)
// onto every selected lead at once. It reuses the exact composer from the
// lead detail sheet (NoteComposerCard + its follow-up bar), so the bulk
// note-taking UX is identical to adding a note on a single lead — same
// textarea, same "Add a follow up task" switch, task type / due / assignee
// / reminder chips.
//
// Notes are append-only, so they insert as one batch. Follow-ups obey the
// "one OPEN task per contact" rule, so they insert per contact and any
// lead that already has an open follow-up is skipped (not an error) — the
// toast reports the tally.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useAccountStaff } from '@/components/members/use-account-staff';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { remindAtIST } from '@/lib/leads/follow-up-dates';
import {
  NoteComposerCard,
  DEFAULT_FOLLOW_UP_DRAFT,
  resolveDueDate,
  type FollowUpDraft,
} from '@/components/contacts/contact-detail-view';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function BulkAddNoteDialog({
  open,
  onOpenChange,
  contactIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The leads the note (and optional follow-up) is written to. */
  contactIds: string[];
  /** Called after a successful write so the page can refresh. */
  onDone?: () => void;
}) {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const { staff } = useAccountStaff();

  const [text, setText] = useState('');
  const [draft, setDraft] = useState<FollowUpDraft>(DEFAULT_FOLLOW_UP_DRAFT);
  const [saving, setSaving] = useState(false);

  // Reset the composer each time the dialog opens — a fresh note every
  // time. Done during render (not an effect) so it never trips the repo's
  // set-state-in-effect rule.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setText('');
      setDraft(DEFAULT_FOLLOW_UP_DRAFT);
      setSaving(false);
    }
  }

  const count = contactIds.length;

  async function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed || count === 0) return;

    const due = resolveDueDate(draft);
    if (draft.enabled && !due) {
      toast.error('Pick a follow-up date');
      return;
    }

    setSaving(true);
    if (!user || !accountId) {
      toast.error('Not authenticated');
      setSaving(false);
      return;
    }

    // One note per selected lead — append-only, so a single batch insert.
    const { data: inserted, error } = await supabase
      .from('contact_notes')
      .insert(
        contactIds.map((id) => ({
          contact_id: id,
          account_id: accountId,
          user_id: user.id,
          note_text: trimmed,
        }))
      )
      .select('id, contact_id');

    if (error || !inserted) {
      toast.error('Failed to add notes');
      setSaving(false);
      return;
    }

    const noteIdByContact = new Map(
      inserted.map((n) => [n.contact_id, n.id])
    );

    // The optional follow-up rides along, one per contact. Insert them
    // individually so a lead that already has an open task is skipped
    // (unique violation) without failing the others.
    let created = 0;
    let skipped = 0;
    let failed = 0;
    if (draft.enabled && due) {
      const remind = draft.remindSlot ? remindAtIST(due, draft.remindSlot) : null;
      const results = await Promise.all(
        contactIds.map((id) =>
          supabase.from('follow_ups').insert({
            account_id: accountId,
            contact_id: id,
            note_id: noteIdByContact.get(id) ?? null,
            assigned_to: draft.assignee || user.id,
            created_by: user.id,
            reason: 'other',
            task_type: draft.type,
            due_date: due,
            remind_at: remind,
            note: trimmed.slice(0, 200),
          })
        )
      );
      for (const r of results) {
        if (!r.error) created++;
        else if (isUniqueViolation(r.error)) skipped++;
        else failed++;
      }
    }

    const n = inserted.length;
    const noteMsg = `Note added to ${n} lead${n === 1 ? '' : 's'}`;
    if (!draft.enabled) {
      toast.success(noteMsg);
    } else {
      const parts = [noteMsg];
      if (created) parts.push(`${created} follow-up${created === 1 ? '' : 's'} created`);
      if (skipped) parts.push(`${skipped} skipped (already had an open follow-up)`);
      if (failed) parts.push(`${failed} follow-up${failed === 1 ? '' : 's'} failed`);
      toast.success(parts.join(' · '));
    }

    setSaving(false);
    onOpenChange(false);
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Add note to {count} {count === 1 ? 'lead' : 'leads'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <NoteComposerCard
            text={text}
            onTextChange={setText}
            draft={draft}
            onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            staff={staff}
            currentUserId={user?.id ?? ''}
            autoFocus
          />
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!text.trim() || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
