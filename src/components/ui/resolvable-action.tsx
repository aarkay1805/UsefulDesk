'use client';

import * as React from 'react';
import Link from 'next/link';
import type { PopoverRootChangeEventDetails } from '@base-ui/react/popover';
import { TriangleAlert, XIcon } from 'lucide-react';

import { usePendingNavigation } from '@/hooks/use-pending-navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  POPOVER_ARROW_SIDE_OFFSET,
  Popover,
  PopoverArrow,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type ActionResolution =
  | { label: string; href: string; onResolve?: never }
  | { label: string; onResolve: () => void; href?: never };

export interface ActionBlocker {
  title: string;
  description: string;
  resolution?: ActionResolution;
}

export type ResolvableActionOpenChangeDetails = PopoverRootChangeEventDetails;

interface ResolvableActionProps {
  trigger: React.ReactElement;
  onAction?: React.MouseEventHandler<HTMLElement>;
  blocker?: ActionBlocker | null;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (
    open: boolean,
    eventDetails?: ResolvableActionOpenChangeDetails
  ) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Override for a custom trigger whose rendered element cannot be
   * classified from its type or explicit nativeButton contract. */
  triggerNativeButton?: boolean;
}

type TriggerProps = React.AriaAttributes & {
  disabled?: boolean;
  nativeButton?: boolean;
  render?: React.ReactElement;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  id?: string;
};

function triggerUsesNativeButton(
  trigger: React.ReactElement,
  override?: boolean
): boolean {
  if (override !== undefined) return override;

  if (typeof trigger.type === 'string') {
    return trigger.type === 'button';
  }

  const props = trigger.props as TriggerProps;
  if (props.nativeButton !== undefined) return props.nativeButton;

  if (trigger.type === Button && React.isValidElement(props.render)) {
    return props.render.type === 'button';
  }

  // Match Base UI's safe default. A custom component that renders a
  // non-button opts out through triggerNativeButton instead of a display-name
  // heuristic or post-render DOM inspection.
  return true;
}

export function ResolvableAction({
  trigger,
  onAction,
  blocker,
  disabled = false,
  open,
  onOpenChange,
  side,
  align,
  triggerNativeButton,
}: ResolvableActionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const { startNavigation, isPending } = usePendingNavigation();
  const triggerProps = trigger.props as TriggerProps;
  const generatedTriggerId = React.useId();
  const triggerId = triggerProps.id ?? generatedTriggerId;
  const blockerPresent = Boolean(blocker);
  const [blockerTransition, setBlockerTransition] = React.useState(() => ({
    blockerPresent,
    controlledOpen: open,
    suppressControlledOpen: false,
    closeGeneration: 0,
  }));

  let suppressControlledOpen = blockerTransition.suppressControlledOpen;
  if (
    blockerTransition.blockerPresent !== blockerPresent ||
    blockerTransition.controlledOpen !== open
  ) {
    const blockerWasRemoved =
      blockerTransition.blockerPresent && !blockerPresent;
    if (blockerWasRemoved && open === true) {
      // A controlled parent may not be able to clear `open` until our close
      // notification runs. Mask that stale intent until it acknowledges false;
      // otherwise A -> null -> A reopens an explanation nobody requested.
      suppressControlledOpen = true;
    }
    if (open === false) suppressControlledOpen = false;

    const shouldNotifyClose =
      blockerWasRemoved && Boolean(open ?? uncontrolledOpen);
    if (shouldNotifyClose) {
      if (open === undefined && uncontrolledOpen) setUncontrolledOpen(false);
    }

    setBlockerTransition({
      blockerPresent,
      controlledOpen: open,
      suppressControlledOpen,
      closeGeneration:
        blockerTransition.closeGeneration + (shouldNotifyClose ? 1 : 0),
    });
  }

  const resolvedOpen = blockerPresent
    ? open === undefined
      ? uncontrolledOpen
      : open && !suppressControlledOpen
    : false;
  const trulyDisabled = disabled || Boolean(triggerProps.disabled);
  const nativeTrigger = triggerUsesNativeButton(trigger, triggerNativeButton);

  const notifyBlockerRemoved = React.useEffectEvent(() => {
    onOpenChange?.(false);
    document.getElementById(triggerId)?.focus();
  });

  React.useLayoutEffect(() => {
    if (blockerTransition.closeGeneration === 0) return;
    notifyBlockerRemoved();
  }, [blockerTransition.closeGeneration]);

  const setResolvedOpen = React.useCallback(
    (nextOpen: boolean, eventDetails?: ResolvableActionOpenChangeDetails) => {
      onOpenChange?.(nextOpen, eventDetails);
      if (open === undefined && !eventDetails?.isCanceled) {
        setUncontrolledOpen(nextOpen);
      }
    },
    [onOpenChange, open]
  );

  const resolvedTrigger = React.cloneElement(
    trigger as React.ReactElement<TriggerProps>,
    {
      disabled: trulyDisabled || undefined,
      id: triggerId,
      className: blocker
        ? cn(
            triggerProps.className,
            'aria-disabled:opacity-60 [&:not(button)]:cursor-pointer focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
          )
        : triggerProps.className,
      onClick: blocker && !trulyDisabled ? undefined : triggerProps.onClick,
      'aria-disabled': blocker && !trulyDisabled ? true : undefined,
      'aria-haspopup': blocker && !trulyDisabled ? 'dialog' : undefined,
      'aria-expanded': blocker && !trulyDisabled ? resolvedOpen : undefined,
    }
  );

  if (!blocker || trulyDisabled) {
    return React.cloneElement(
      resolvedTrigger as React.ReactElement<
        TriggerProps & { onClick?: React.MouseEventHandler<HTMLElement> }
      >,
      {
        // `onAction` is the wrapper's authoritative business callback. When
        // it is supplied it takes precedence over a trigger handler so one
        // activation cannot execute the same action twice. Handler-only
        // triggers keep working when no wrapper callback is supplied.
        onClick: trulyDisabled ? undefined : (onAction ?? triggerProps.onClick),
      }
    );
  }

  const activeBlocker = blocker;
  const resolution = activeBlocker.resolution;
  const resolutionHref =
    resolution && 'href' in resolution ? resolution.href : undefined;

  function resolveInline() {
    setResolvedOpen(false);
    if (
      activeBlocker.resolution &&
      'onResolve' in activeBlocker.resolution &&
      activeBlocker.resolution.onResolve
    ) {
      activeBlocker.resolution.onResolve();
    }
  }

  return (
    <Popover open={resolvedOpen} onOpenChange={setResolvedOpen}>
      <Tooltip>
        <TooltipTrigger
          disabled={resolvedOpen}
          render={
            <PopoverTrigger
              nativeButton={nativeTrigger}
              render={resolvedTrigger}
            />
          }
        />
        <TooltipContent>{activeBlocker.title}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={POPOVER_ARROW_SIDE_OFFSET}
        // The one popover framed at 16px rather than the master's 10px: this
        // panel is read, not picked from, so its message gets a card's frame.
        // `relative` anchors the dismiss control; the tail keeps its place
        // because the popup and the positioner share a box.
        className="relative p-4"
      >
        {/* The house alert grammar (`ui/alert.tsx`): warning glyph in its own
         * column, message beside it, resolution left-aligned under the copy.
         * Composed rather than nesting an `Alert`, whose card and `role=alert`
         * would box a panel inside a panel and re-announce the popup. */}
        <div className="grid grid-cols-[auto_1fr] gap-x-2.5">
          <TriangleAlert
            aria-hidden="true"
            className="text-amber-foreground size-4 shrink-0 translate-y-0.5"
          />
          <PopoverHeader>
            {/* Reserves the width the dismiss control overlaps, so a long
             * title wraps before it instead of running underneath. */}
            <PopoverTitle className="pr-5">{activeBlocker.title}</PopoverTitle>
            <PopoverDescription className="text-pretty">
              {activeBlocker.description}
            </PopoverDescription>
          </PopoverHeader>
          {resolution ? (
            <div className="col-start-2 mt-2.5">
              {resolutionHref ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={resolutionHref} />}
                  loading={isPending(resolutionHref)}
                  onClick={() => startNavigation(resolutionHref)}
                >
                  {resolution.label}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={resolveInline}>
                  {resolution.label}
                </Button>
              )}
            </div>
          ) : null}
        </div>
        <PopoverClose
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-2 right-2"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </PopoverClose>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}
