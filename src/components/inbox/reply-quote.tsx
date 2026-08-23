'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Message } from '@/types';

interface ReplyQuoteProps {
  /** Sender label of the quoted message: "You" for our own messages,
   *  contact name for customer-sent messages. Caller resolves this — the
   *  quote component doesn't see the parent Message. */
  authorLabel: string;
  /** Compact text preview. Falls back to a placeholder for media types. */
  preview: string;
  /** Present → renders the composer-chip variant with an X button. Absent →
   *  renders the embedded-in-bubble variant. */
  onDismiss?: () => void;
  /** True when embedded inside an outbound bubble. Only the panel tint and
   *  the preview tone key off this now — since the outbound bubble became an
   *  accent tint rather than a solid accent fill, both bubbles carry ordinary
   *  foreground text and the quote no longer needs an inverted palette. */
  onOutbound?: boolean;
}

/**
 * The quoted-message panel, shaped like WhatsApp's: a rounded block inset in
 * the bubble, a solid accent bar down its leading edge, the author on top, and
 * a clamped preview beneath. The bar is the one place a thick coloured edge
 * earns its keep — it is how every messaging client on the market signals "this
 * is a quote", and losing it costs more recognition than the rule protects.
 */
export function ReplyQuote({
  authorLabel,
  preview,
  onDismiss,
  onOutbound = false,
}: ReplyQuoteProps) {
  const isChip = !!onDismiss;
  return (
    <div
      className={cn(
        'flex items-start gap-2 overflow-hidden border-l-4 py-1 pr-2 pl-2',
        'border-l-primary',
        // Concentric with whichever surface hosts it. In a bubble the gap is
        // 4px inside a 10px corner (6 + 4 = 10); in the composer shell it is
        // 8px inside an 18px corner (10 + 8 = 18).
        isChip
          ? 'bg-foreground/[0.06] rounded-lg'
          : cn(
              'mb-1 rounded-sm',
              onOutbound ? 'bg-foreground/10' : 'bg-foreground/[0.06]'
            )
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="text-primary-text truncate text-xs font-medium">
          {authorLabel}
        </div>
        {/* Clamped rather than truncated to one line: a quote is context, so
         *  two lines of it is the useful amount, and `line-clamp` wraps long
         *  URLs that `truncate` (white-space: nowrap) used to stretch the
         *  whole inbox around. Issue #165. */}
        <div className="text-chat-meta line-clamp-2 text-xs break-words">
          {preview}
        </div>
      </div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          aria-label="Cancel reply"
          className="-mr-1"
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/** Build the one-line preview text shown inside a reply quote. */
export function buildReplyPreview(message: Message): string {
  if (message.content_text) return message.content_text;
  switch (message.content_type) {
    case 'image':
      return '[Image]';
    case 'video':
      return '[Video]';
    case 'audio':
      return '[Audio]';
    case 'document':
      return '[Document]';
    case 'location':
      return '[Location]';
    case 'template':
      return '[Template]';
    default:
      return '[Message]';
  }
}
