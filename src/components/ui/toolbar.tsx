'use client';

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { Toolbar as ToolbarPrimitive } from '@base-ui/react/toolbar';

import { cn } from '@/lib/utils';

const toolbarItemClasses =
  "inline-flex h-full shrink-0 items-center justify-center gap-1.5 px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function Toolbar({
  className,
  orientation = 'horizontal',
  ...props
}: ToolbarPrimitive.Root.Props) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      orientation={orientation}
      className={cn(
        'border-border bg-background dark:bg-input/30 inline-flex h-8 items-stretch overflow-hidden rounded-lg border',
        className
      )}
      {...props}
    />
  );
}

function ToolbarGroup({ className, ...props }: ToolbarPrimitive.Group.Props) {
  return (
    <ToolbarPrimitive.Group
      data-slot="toolbar-group"
      className={cn('inline-flex items-stretch', className)}
      {...props}
    />
  );
}

function ToolbarButton({ className, ...props }: ToolbarPrimitive.Button.Props) {
  return (
    <ToolbarPrimitive.Button
      data-slot="toolbar-button"
      className={cn(toolbarItemClasses, className)}
      {...props}
    />
  );
}

function ToolbarToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toolbar-toggle-group"
      className={cn(
        'divide-border inline-flex items-stretch divide-x',
        className
      )}
      {...props}
    />
  );
}

function ToolbarToggleItem({
  className,
  ...props
}: ToolbarPrimitive.Button.Props) {
  return (
    <ToolbarPrimitive.Button
      data-slot="toolbar-toggle-item"
      render={<TogglePrimitive />}
      className={cn(
        toolbarItemClasses,
        'data-pressed:bg-primary/10 data-pressed:text-primary-text',
        className
      )}
      {...props}
    />
  );
}

function ToolbarSeparator({
  className,
  ...props
}: ToolbarPrimitive.Separator.Props) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn(
        'bg-border shrink-0 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
        className
      )}
      {...props}
    />
  );
}

export {
  Toolbar,
  ToolbarGroup,
  ToolbarButton,
  ToolbarToggleGroup,
  ToolbarToggleItem,
  ToolbarSeparator,
};
