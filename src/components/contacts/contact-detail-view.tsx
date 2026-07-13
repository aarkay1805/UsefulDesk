'use client';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ContactDetailContent } from './contact-detail-content';

// The detail surface itself (identity header, quick actions, Details /
// Tags / Notes) lives in contact-detail-content.tsx so the inbox's
// contact panel can mount the same component instead of carrying its own
// fork. This file is now just the /leads Sheet host. Same reasoning as
// contact-notes-thread.tsx, which the member detail sheet reuses.
export {
  NoteComposerCard,
  DEFAULT_FOLLOW_UP_DRAFT,
  resolveDueDate,
  type FollowUpDraft,
} from './contact-notes-thread';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The sheet master caps side=right at sm:max-w-sm (384px) via a
        // data-variant, which beats a plain sm:max-w-*. Match the
        // variant to actually widen: 500px fits the follow-up row on
        // one line.
        className="bg-popover border-border text-popover-foreground data-[side=right]:sm:max-w-[500px] w-full p-0"
      >
        <ContactDetailContent
          contactId={contactId}
          active={open}
          variant="sheet"
          onUpdated={onUpdated}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
