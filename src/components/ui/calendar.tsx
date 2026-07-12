"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButtonProps,
  type DropdownProps,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

/**
 * Calendar — the design-system month grid (react-day-picker), used by
 * `DatePicker`. Month/year dropdown navigation goes through `ui/select`
 * (never the library's native `<select>`), day cells through
 * `buttonVariants`. Restyle via `classNames`, don't fork.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("group/calendar p-2 [--cell-size:--spacing(8)]", className)}
      classNames={{
        // Fixed overall width sized for the longest month name ("September") —
        // the popup must never resize as the caption text changes; the day
        // cells flex to fill it instead.
        root: cn("w-[16.5rem]", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        // The nav is an absolute full-width strip painting over the caption
        // (positioned beats static) — without pointer-events-none it swallows
        // every click on the month/year dropdown triggers underneath.
        nav: cn(
          "pointer-events-none absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "pointer-events-auto size-(--cell-size) select-none text-muted-foreground aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "pointer-events-auto size-(--cell-size) select-none text-muted-foreground aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn("relative", defaultClassNames.dropdown_root),
        // Fixed trigger widths (passed through CalendarDropdown onto the
        // SelectTrigger) so "May" and "September" occupy the same box.
        months_dropdown: "w-[6.5rem]",
        years_dropdown: "w-[4.5rem]",
        caption_label: cn(
          "select-none text-sm font-medium",
          defaultClassNames.caption_label
        ),
        month_grid: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 select-none rounded-md text-center text-[0.8rem] font-normal text-muted-foreground",
          defaultClassNames.weekday
        ),
        week: cn("mt-1.5 flex w-full", defaultClassNames.week),
        // Cells flex-share the fixed root width; the square day button
        // centres inside its cell.
        day: cn(
          "group/day relative flex h-(--cell-size) flex-1 items-center justify-center p-0 text-center select-none",
          defaultClassNames.day
        ),
        footer: cn("mt-1.5", defaultClassNames.footer),
        today: cn(
          "rounded-lg bg-muted text-foreground",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground/60 aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation, ...chevronProps }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeftIcon
              : orientation === "right"
                ? ChevronRightIcon
                : ChevronDownIcon
          return <Icon className={cn("size-4", className)} {...chevronProps} />
        },
        DayButton: CalendarDayButton,
        Dropdown: CalendarDropdown,
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({ className, day, modifiers, ...props }: DayButtonProps) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.date.toDateString()}
      data-selected={modifiers.selected || undefined}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "size-(--cell-size) min-w-0 p-0 font-normal leading-none data-selected:bg-primary data-selected:text-primary-foreground data-selected:hover:bg-primary",
        className
      )}
      {...props}
    />
  )
}

/** Month/year caption picker — `ui/select` instead of a native `<select>`. */
function CalendarDropdown({
  options = [],
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: DropdownProps) {
  const selected = options.find((o) => String(o.value) === String(value))
  return (
    <Select
      value={value != null ? String(value) : undefined}
      onValueChange={(v) => {
        if (v == null) return
        // react-day-picker expects a <select> change event; hand it the shape it reads.
        onChange?.({
          target: { value: v },
        } as unknown as React.ChangeEvent<HTMLSelectElement>)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className={cn(
          "gap-1 border-transparent bg-transparent px-1.5 font-medium hover:bg-muted",
          className
        )}
      >
        <span className="truncate">{selected?.label}</span>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-72">
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { Calendar }
