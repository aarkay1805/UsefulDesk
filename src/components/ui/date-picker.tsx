"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLocale } from "@/hooks/use-locale"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' → local Date (from parts — never `new Date(str)`). */
function parseDay(value?: string): Date | undefined {
  if (!value) return undefined
  const m = YMD.exec(value)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function toYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

interface DatePickerProps {
  /** 'YYYY-MM-DD' or '' — same contract as `<input type="date">`. */
  value: string
  onChange: (value: string) => void
  /** Inclusive 'YYYY-MM-DD' bounds (earlier/later days disabled). */
  min?: string
  max?: string
  id?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  "aria-label"?: string
}

/**
 * DatePicker — the canonical date field. A whole-field-clickable trigger
 * styled like `Input` opening a `Calendar` popover; displays via the
 * account locale's `fmt.date`, week starts per `locale.weekStart`.
 * Drop-in for `<input type="date">`: value stays a 'YYYY-MM-DD' string.
 */
function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  disabled,
  placeholder = "Pick a date",
  className,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const { locale, fmt } = useLocale()
  const [open, setOpen] = React.useState(false)

  const selected = parseDay(value)
  const minDate = parseDay(min)
  const maxDate = parseDay(max)
  // Account-tz today ('YYYY-MM-DD' compares lexically), shown only when in bounds.
  const today = fmt.today()
  const todayAllowed = (!min || today >= min) && (!max || today <= max)
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]
  const currentYear = new Date().getFullYear()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        data-slot="date-picker-trigger"
        className={cn(
          // Mirrors ui/input.tsx tokens so the field reads as an Input.
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input-border bg-transparent px-2.5 py-1 text-left text-base whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
          className
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value ? fmt.date(value) : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(d ? toYmd(d) : "")
            setOpen(false)
          }}
          defaultMonth={selected ?? maxDate}
          weekStartsOn={locale.weekStart}
          disabled={disabledDays.length ? disabledDays : undefined}
          startMonth={minDate ?? new Date(currentYear - 100, 0)}
          endMonth={maxDate ?? new Date(currentYear + 5, 11)}
          autoFocus
          footer={
            todayAllowed && (
              <button
                type="button"
                className="px-1 text-sm font-medium text-primary-text underline-offset-4 outline-none hover:underline focus-visible:underline"
                onClick={() => {
                  onChange(today)
                  setOpen(false)
                }}
              >
                Today
              </button>
            )
          }
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
