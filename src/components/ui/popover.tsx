'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { cn } from '@/lib/utils';

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset'
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 outline-hidden duration-100',
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

/**
 * The gap a popover needs between itself and its anchor to fit `PopoverArrow`:
 * the tail's 9.9px reach plus a 2px breath before the control. Pass it as
 * `sideOffset` on any `PopoverContent` that renders a tail — the default 4px
 * gap is narrower than the tail, so the tip would stab into the anchor.
 */
const POPOVER_ARROW_SIDE_OFFSET = 12;

/**
 * Optional tail that ties a popover to the control it explains. Opt-in, and
 * paired with `POPOVER_ARROW_SIDE_OFFSET`.
 *
 * A tooltip's tail needs no edge — it is a solid dark chip on any background.
 * This one sits on `bg-popover`, which reads as a panel because of its ring
 * rather than its fill, so an unedged tail all but disappears. `rotate-45`
 * maps the square's top/left edges to the tail's upper pair and its
 * bottom/right edges to the lower pair, so bordering the two that face away
 * from the panel continues the ring around the tip and leaves the base open.
 *
 * Base UI positions only the cross axis (an inline `left` on a vertical side,
 * `top` on a horizontal one), which already centres the square on the anchor;
 * the static side is ours. Pinning that side to 0 and pulling back half the
 * square puts the tail's centre exactly on the panel's edge, so its widest cut
 * — the open base — lands on the border line and the two hairlines meet the
 * ring there instead of crossing into the panel.
 */
function PopoverArrow({ className, ...props }: PopoverPrimitive.Arrow.Props) {
  return (
    <PopoverPrimitive.Arrow
      data-slot="popover-arrow"
      className={cn(
        'bg-popover border-foreground/10 z-50 size-3.5 rotate-45 rounded-[2px] data-[side=bottom]:top-0 data-[side=bottom]:-translate-y-1/2 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=inline-end]:left-0 data-[side=inline-end]:-translate-x-1/2 data-[side=inline-end]:border-b data-[side=inline-end]:border-l data-[side=inline-start]:right-0 data-[side=inline-start]:translate-x-1/2 data-[side=inline-start]:border-t data-[side=inline-start]:border-r data-[side=left]:right-0 data-[side=left]:translate-x-1/2 data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:left-0 data-[side=right]:-translate-x-1/2 data-[side=right]:border-b data-[side=right]:border-l data-[side=top]:bottom-0 data-[side=top]:translate-y-1/2 data-[side=top]:border-r data-[side=top]:border-b',
        className
      )}
      {...props}
    />
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-0.5 text-sm', className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('font-heading font-medium', className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  POPOVER_ARROW_SIDE_OFFSET,
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
