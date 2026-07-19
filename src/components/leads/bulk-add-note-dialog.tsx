'use client';

// BulkAddNoteDialog — write one append-only note onto every selected person.
// Manual follow-ups deliberately stay out of this bulk surface: they are
// created only from a person's row action or their profile Notes section.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  Dialog,
  DialogContent,
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
  /** The leads the note (and optional follow-up) is written to. */
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

    const n = inserted.length;
    toast.success(`Note added to ${n} ${noun}${n === 1 ? '' : 's'}`);

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
        </DialogHeader>

        <div className="py-2">
          <Textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write a note..."
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
          <Button onClick={handleAdd} disabled={!text.trim() || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
