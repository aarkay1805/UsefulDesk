'use client';

import * as React from 'react';
import Link from 'next/link';

import { usePendingNavigation } from '@/hooks/use-pending-navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
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

interface ResolvableActionProps {
  trigger: React.ReactElement;
  onAction?: React.MouseEventHandler<HTMLElement>;
  blocker?: ActionBlocker | null;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  const resolvedOpen = open ?? uncontrolledOpen;
  const triggerProps = trigger.props as TriggerProps;
  const trulyDisabled = disabled || Boolean(triggerProps.disabled);
  const nativeTrigger = triggerUsesNativeButton(trigger, triggerNativeButton);

  const setResolvedOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open]
  );

  const resolvedTrigger = React.cloneElement(
    trigger as React.ReactElement<TriggerProps>,
    {
      disabled: trulyDisabled || undefined,
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
        onClick: trulyDisabled ? undefined : onAction,
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
      <PopoverContent side={side} align={align}>
        <PopoverHeader>
          <PopoverTitle>{activeBlocker.title}</PopoverTitle>
          <PopoverDescription>{activeBlocker.description}</PopoverDescription>
        </PopoverHeader>
        {resolution ? (
          <div className="flex justify-end">
            {resolutionHref ? (
              <Button
                nativeButton={false}
                render={<Link href={resolutionHref} />}
                loading={isPending(resolutionHref)}
                onClick={() => startNavigation(resolutionHref)}
              >
                {resolution.label}
              </Button>
            ) : (
              <Button onClick={resolveInline}>{resolution.label}</Button>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
