'use client';

// FollowUpComposer — the ONE manual follow-up writing surface: a
// borderless note textarea with the shared follow-up field set attached
// beneath it in a single bordered container.
//
// It was extracted from ContactNotesThread's private NoteComposerCard so
// the standalone Create-follow-up dialog renders the exact same block the
// profile "Notes & follow-ups" section does. The profile composer is the
// base reference; anything that creates a follow-up by hand mounts this.
//
// The two contexts differ only in what is required:
//   - profile composer: note required, follow-up toggled on
//   - standalone dialog: follow-up required, note optional
// which is expressed by `showEnabledToggle` and the host's own footer —
// never by a second layout.

import { Textarea } from '@/components/ui/textarea';
import type { StaffMember } from '@/components/members/use-account-staff';
import { FollowUpFields, type FollowUpDraft } from './follow-up-fields';

/** One example for every manual composer — leads and members alike. */
export const NOTE_PLACEHOLDER =
  'e.g. Called about renewal — will decide after payday';

interface FollowUpComposerProps {
  text: string;
  onTextChange: (value: string) => void;
  /** ⌘/Ctrl+Enter accelerator — Enter still inserts a newline. */
  onSubmit?: () => void;
  draft: FollowUpDraft;
  onPatch: (patch: Partial<FollowUpDraft>) => void;
  staff: StaffMember[];
  currentUserId: string;
  /** Member follow-ups explain the renewal/retention reason; lead
   *  follow-ups are general sales work and omit that taxonomy. */
  showReason: boolean;
  /** Profile notes toggle a follow-up on; the standalone dialog is
   *  already a follow-up, so it hides the switch and keeps fields open. */
  showEnabledToggle?: boolean;
  /** Overrides the shared example only where the note is optional. */
  placeholder?: string;
  /** Accessible name for the note field. */
  noteLabel?: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
}

export function FollowUpComposer({
  text,
  onTextChange,
  onSubmit,
  draft,
  onPatch,
  staff,
  currentUserId,
  showReason,
  showEnabledToggle = true,
  placeholder = NOTE_PLACEHOLDER,
  noteLabel = 'Note',
  textareaRef,
  autoFocus,
}: FollowUpComposerProps) {
  return (
    // bg-card (not bg-muted) — the switch's unchecked track is muted
    // grey and disappears on a grey card.
    <div className="border-border bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-lg border transition-colors focus-within:ring-3">
      <Textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit?.();
          }
        }}
        placeholder={placeholder}
        aria-label={noteLabel}
        // The master already grows with its content; the cap keeps a long
        // note from pushing the follow-up fields out of the sheet.
        className="text-foreground placeholder:text-muted-foreground max-h-56 resize-none overflow-y-auto border-0 bg-transparent text-sm focus-visible:border-transparent focus-visible:ring-0"
      />
      <FollowUpFields
        draft={draft}
        onPatch={onPatch}
        staff={staff}
        currentUserId={currentUserId}
        showReason={showReason}
        showEnabledToggle={showEnabledToggle}
      />
    </div>
  );
}
