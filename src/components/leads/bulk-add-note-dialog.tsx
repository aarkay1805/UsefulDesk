'use client';

// BulkAddNoteDialog — write one append-only note onto every selected person.
// Manual follow-ups deliberately stay out of this bulk surface: they are
// created only from a person's row action or their profile Notes section.

import { useState } from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/hooks/use-auth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function BulkAddNoteDialog({
  open,
  onOpenChange,
  contactIds,
  onDone,
  noun = 'lead',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The people the note is written to — one `contact_notes` row each. */
  contactIds: string[];
  /** Called after a successful write so the page can refresh. */
  onDone?: () => void;
  /** What a contact is called in the toast/title — 'lead' here, 'member'
   *  when the members bulk toolbar reuses this dialog. */
  noun?: string;
}) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset the composer each time the dialog opens — a fresh note every
  // time. Done during render (not an effect) so it never trips the repo's
  // set-state-in-effect rule.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setText('');
      setSaving(false);
    }
  }

  const count = contactIds.length;

  async function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed || count === 0) return;

    setSaving(true);
    if (!user || !accountId) {
      toast.error('Your session has expired. Sign in again to save this note.');
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
      toast.error(
        getErrorMessage(
          error,
          "Couldn't add the note. Check your connection and try again."
        )
      );
      setSaving(false);
      return;
    }

    // An RLS-blocked insert returns no error and fewer rows (repo gotcha), so
    // `inserted.length` — not the request — decides what the user is told.
    // Reporting "added to 0 leads" as a success was the previous behaviour.
    const n = inserted.length;
    if (n === 0) {
      toast.error("The note wasn't added. Refresh and try again.");
      setSaving(false);
      return;
    }
    if (n < count) {
      toast.warning(
        `Note added to ${n} of ${count} ${noun}s. Refresh and try the rest again.`
      );
    } else {
      toast.success(`Note added to ${n} ${noun}${n === 1 ? '' : 's'}`);
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
            Add note to {count} {noun}
            {count === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            {count === 1
              ? 'The note is added to their profile timeline.'
              : `The same note is added to each ${noun}'s profile timeline.`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g. Called about the festive offer — no answer"
            aria-label="Note"
            className="min-h-28 resize-none"
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
          <Button
            onClick={handleAdd}
            disabled={!text.trim() || saving}
            loading={saving}
          >
            Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
