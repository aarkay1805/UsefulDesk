'use client';

import { Toggle as ChipPrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ChipGroupPrimitive } from '@base-ui/react/toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Chips are compact pill-shaped choices. They always live in a ChipGroup so
 * the caller must declare whether the choices allow one or many selections.
 * The visual recipe is intentionally singular: a chip must never drift into
 * an outline Button or a standalone rounded Toggle.
 */
const chipVariants = cva(
  "group/chip inline-flex items-center justify-center gap-1 rounded-full border border-input bg-transparent text-sm font-medium whitespace-nowrap text-muted-foreground transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary-text data-pressed:border-primary/30 data-pressed:bg-primary/10 data-pressed:text-primary-text dark:aria-invalid:ring-destructive/40 dark:aria-pressed:border-primary/40 dark:aria-pressed:bg-primary/15 dark:data-pressed:border-primary/40 dark:data-pressed:bg-primary/15 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
  return (
    <ChipGroupPrimitive
      data-slot="chip-group"
      data-selection-mode={selectionMode}
      multiple={selectionMode === 'multiple'}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      {...props}
    />
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

export { Chip, ChipGroup, chipVariants };
