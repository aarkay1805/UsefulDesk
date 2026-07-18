'use client';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ContactDetailContent } from './contact-detail-content';

// The detail surface itself (identity header, quick actions, Details /
// Tags / Notes) lives in contact-detail-content.tsx so the inbox's
// contact panel can mount the same component instead of carrying its own
// fork. This file is now just the /leads Sheet host. Same reasoning as
// contact-notes-thread.tsx, which the member detail sheet reuses.
export { NoteComposerCard } from './contact-notes-thread';
export {
  DEFAULT_FOLLOW_UP_DRAFT,
  resolveDueDate,
  type FollowUpDraft,
} from '@/components/follow-ups/follow-up-fields';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  /** Section to land on when the sheet opens (deep links from notifications). */
  initialFocus?: 'followup' | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  initialFocus = null,
  onUpdated,
}: ContactDetailViewProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The sheet master sets `data-[side=right]:w-3/4` + `:sm:max-w-sm`
        // (384px), and tailwind-merge only dedupes utilities of the SAME
        // variant — so BOTH overrides must carry the data-[side=right]:
        // prefix. A bare `w-full` loses and pins the sheet to 75vw, which
        // only showed up on a phone (on desktop the max-w capped it first).
        // 500px fits the follow-up row on one line.
        className="bg-popover border-border text-popover-foreground p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[500px]"
      >
        <ContactDetailContent
          contactId={contactId}
          active={open}
          variant="sheet"
          initialFocus={initialFocus}
          onUpdated={onUpdated}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
