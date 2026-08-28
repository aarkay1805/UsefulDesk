'use client';

import { useState, type ReactNode } from 'react';
import { CornerUpLeft, Copy, SmilePlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Message } from '@/types';

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface MessageActionsProps {
  message: Message;
  /** Omitted while replying is impossible — a closed 24-hour session hides
   *  the composer, so a Reply would arm a quote with nowhere to land. */
  onReply?: () => void;
  onReact: (emoji: string) => void;
  children: ReactNode;
}

/**
 * Hover/long-press toolbar wrapper around a `<MessageBubble>`. The bubble
 * itself stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when the toolbar isn't visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  children,
}: MessageActionsProps) {
  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar open until the user
  // interacts elsewhere.
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isAgent =
    message.sender_type === 'agent' || message.sender_type === 'bot';

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? '';
    if (!text) {
      toast.error('Nothing to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply?.();
    setTouchOpen(false);
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      className={cn('flex w-full', isAgent ? 'justify-end' : 'justify-start')}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative max-w-[min(65%,30rem)] min-w-0">
        {children}
        <div
          data-touch-open={touchOpen || pickerOpen ? 'true' : undefined}
          className={cn(
            // The edge is a ring, not a border, for a geometric reason: a 1px border
            // is layout, so it pushes the buttons 5px inside a 14px corner and
            // breaks the 10 + 4 pair. A ring paints outside the box and leaves the
            // gap at exactly 4px. Same idiom as the composer shell.
            'ring-border bg-popover/95 absolute top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-xl p-1 shadow-md ring-1 backdrop-blur-sm transition-opacity',
            'opacity-0 group-focus-within/actions:opacity-100 group-hover/actions:opacity-100',
            'data-[touch-open=true]:opacity-100',
            // Beside the bubble, not over it. Floating the toolbar on the
            // bubble's top edge covered the first line of every one-line
            // message — exactly the messages people hover most — and collided
            // with the tail. Bubbles cap at 65% of the pane, so the inner
            // gutter is always there to put it in, which is where WhatsApp
            // Web puts its own react affordance.
            isAgent ? 'right-full mr-2' : 'left-full ml-2'
          )}
        >
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              render={<Button variant="ghost" size="icon" />}
              aria-label="React"
            >
              <SmilePlus />
            </PopoverTrigger>
            <PopoverContent
              className="flex w-auto flex-row gap-1 p-1.5"
              sideOffset={6}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => handlePickEmoji(e)}
                  className="hover:bg-muted flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125"
                  aria-label={`React with ${e}`}
                >
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          {onReply && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReply}
              aria-label="Reply"
            >
              <CornerUpLeft />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            aria-label="Copy"
          >
            <Copy />
          </Button>
        </div>
      </div>
    </div>
  );
}
