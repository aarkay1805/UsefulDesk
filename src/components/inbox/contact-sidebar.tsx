"use client";

import type { Contact } from "@/types";
import {
  ContactDetailContent,
  type ContactQuickActionId,
} from "@/components/contacts/contact-detail-content";
import { Sheet, SheetContent } from "@/components/ui/sheet";

/**
 * Quick actions the inbox drops:
 * - `chat` opens the contact's conversation in the inbox — you're already
 *   standing in it.
 * - `template` is redundant next to the thread's own composer.
 * Everything else (Convert, Call, Note, Email) is the same action the
 * /leads sheet fires.
 */
const INBOX_ACTIONS: ContactQuickActionId[] = [
  "convert",
  "call",
  "note",
  "email",
];

// Details starts collapsed: 13 label/value rows in a 360px rail is a wall,
// and the agent opened the inbox to talk, not to audit fields. One click
// away, and Tags + Notes — the two they actually touch mid-conversation —
// stay open.
const INBOX_COLLAPSED_SECTIONS = ["details"];

interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * Fires after any edit made in the panel (rename, status, tags, owner…).
   * The inbox re-pulls the contact so the thread header and conversation
   * list can't show a stale name.
   */
  onUpdated?: () => void;
}

/**
 * The inbox's right-hand contact panel. Deliberately NOT its own view —
 * it mounts `ContactDetailContent`, the same surface the /leads detail
 * sheet renders, so the two read from one source of truth and differ only
 * by the actions above. It used to be a separate, stale fork (read-only
 * tags, note composer with no author/edit/delete/follow-ups, and an
 * "Active Deals" block for the long-retired pipelines feature).
 */
export function ContactSidebar({ contact, onUpdated }: ContactSidebarProps) {
  if (!contact) {
    return (
      <div className="flex h-full w-90 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">Select a conversation</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-90 flex-col border-l border-border bg-card">
      <ContactDetailContent
        // Re-mount on contact switch so no state (open editor, note draft
        // focus) leaks from the previous conversation's contact.
        key={contact.id}
        contactId={contact.id}
        active
        variant="panel"
        actions={INBOX_ACTIONS}
        collapsedSections={INBOX_COLLAPSED_SECTIONS}
        onUpdated={onUpdated ?? (() => {})}
      />
    </div>
  );
}

interface ContactProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onUpdated?: () => void;
}

/**
 * The mobile face of the same surface. Below `lg` the inbox is a single
 * pane (list OR thread), so there is no room for a third column — the
 * profile arrives as an overlay Sheet instead. Same `ContactDetailContent`,
 * same actions, only the chrome differs, so the two can't drift.
 *
 * Details renders EXPANDED here (unlike the 360px desktop rail, where 13
 * label/value rows are a wall): the sheet is full-width on a phone, so the
 * fields fit — and collapsing them would cost an extra tap on the exact
 * thing you opened the sheet to read.
 */
export function ContactProfileSheet({
  open,
  onOpenChange,
  contact,
  onUpdated,
}: ContactProfileSheetProps) {
  return (
    <Sheet open={open && !!contact} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // BOTH width classes must carry the data-[side=right]: prefix. The
        // sheet master sets `data-[side=right]:w-3/4` + `:sm:max-w-sm`, and
        // tailwind-merge only dedupes utilities of the SAME variant — so a
        // bare `w-full` loses to the master and pins the sheet to 75vw,
        // which on a phone crops the Details values ("+91977920…"). See the
        // sheet-width gotcha in CLAUDE.md.
        className="bg-popover border-border text-popover-foreground p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[420px]"
      >
        {contact && (
          <ContactDetailContent
            key={contact.id}
            contactId={contact.id}
            active={open}
            variant="sheet"
            actions={INBOX_ACTIONS}
            onUpdated={onUpdated ?? (() => {})}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
