'use client';

import { Toggle as ChipPrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ChipGroupPrimitive } from '@base-ui/react/toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Chips are compact pill-shaped choices. They always live in a ChipGroup so
 * the caller must declare whether the choices allow one or many selections.
 * The visual recipe is intentionally singular: a chip must never drift into
 * an outline Button or a standalone rounded Toggle.
 */
const chipVariants = cva(
  "group/chip inline-flex items-center justify-center gap-1 rounded-full border border-input bg-transparent text-sm font-medium whitespace-nowrap text-muted-foreground transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary-text aria-pressed:[&_[data-slot=badge]]:bg-primary/20 aria-pressed:[&_[data-slot=badge]]:text-primary-text data-pressed:border-primary/30 data-pressed:bg-primary/10 data-pressed:text-primary-text data-pressed:[&_[data-slot=badge]]:bg-primary/20 data-pressed:[&_[data-slot=badge]]:text-primary-text dark:aria-invalid:ring-destructive/40 dark:aria-pressed:border-primary/40 dark:aria-pressed:bg-primary/15 dark:data-pressed:border-primary/40 dark:data-pressed:bg-primary/15 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default:
          'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-7 min-w-7 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 min-w-9 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

function ChipGroup<Value extends string>({
  className,
  selectionMode,
  ...props
}: Omit<ChipGroupPrimitive.Props<Value>, 'multiple'> & {
  /** Whether one chip or any number of chips may be selected. */
  selectionMode: 'single' | 'multiple';
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const next = {
      left: viewport.scrollLeft > 1,
      right: viewport.scrollLeft < maxScrollLeft - 1,
    };
    setScrollState((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next
    );
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let frame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateScrollState);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener('scroll', scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener('scroll', scheduleUpdate);
    };
  }, [updateScrollState]);

  function browse(direction: 'previous' | 'next') {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = Math.max(120, viewport.clientWidth - 48);
    viewport.scrollBy({
      left: direction === 'previous' ? -distance : distance,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }

  return (
    <div
      data-slot="chip-scroller"
      className={cn('relative min-w-0 flex-1', className)}
    >
      <div
        ref={viewportRef}
        data-slot="chip-scroll-viewport"
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ChipGroupPrimitive
          ref={contentRef}
          data-slot="chip-group"
          data-selection-mode={selectionMode}
          multiple={selectionMode === 'multiple'}
          className="flex w-max flex-nowrap items-center gap-1.5"
          {...props}
        />
      </div>

      {scrollState.left && (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Previous chips"
          title="Previous chips"
          onClick={() => browse('previous')}
          className="absolute top-1/2 left-0 z-10 -translate-y-1/2 shadow-sm"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
      )}
      {scrollState.right && (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="More chips"
          title="More chips"
          onClick={() => browse('next')}
          className="absolute top-1/2 right-0 z-10 -translate-y-1/2 shadow-sm"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function Chip<Value extends string>({
  className,
  size = 'default',
  ...props
}: ChipPrimitive.Props<Value> & VariantProps<typeof chipVariants>) {
  return (
    <ChipPrimitive
      data-slot="chip"
      className={cn(chipVariants({ size, className }))}
      {...props}
    />
  );
}

function ChipCount({ count }: { count: number | string }) {
  return (
    <Badge variant="neutral" size="count">
      {count}
    </Badge>
  );
}

export { Chip, ChipCount, ChipGroup, chipVariants };
