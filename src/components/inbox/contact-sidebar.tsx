"use client";

import type { Contact } from "@/types";
import {
  ContactDetailContent,
  type ContactQuickActionId,
} from "@/components/contacts/contact-detail-content";

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
