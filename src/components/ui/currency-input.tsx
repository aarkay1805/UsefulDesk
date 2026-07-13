"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Intl instances are expensive to build; cache per locale tag. */
const nfCache = new Map<string, Intl.NumberFormat>();
function grouper(locale: string): Intl.NumberFormat {
  let f = nfCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    nfCache.set(locale, f);
  }
  return f;
}

/** Digits plus at most one decimal point — the raw value we store. */
function sanitizeAmount(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const [head, ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${head}.${rest.join("")}` : head;
}

/**
 * Group a RAW amount for display ("100000" → "1,00,000" in en-IN,
 * "100,000" in en-US). Keeps a half-typed decimal intact ("1000." →
 * "1,000.") so grouping never fights the keyboard.
 */
function groupAmount(raw: string, locale: string): string {
  if (raw === "") return "";
  const dot = raw.indexOf(".");
  const int = dot === -1 ? raw : raw.slice(0, dot);
  const dec = dot === -1 ? null : raw.slice(dot + 1);
  const grouped = int === "" ? "" : grouper(locale).format(Number(int));
  return dec === null ? grouped : `${grouped}.${dec}`;
}

const countAmountChars = (s: string) => s.replace(/[^0-9.]/g, "").length;

/** Caret offset in `formatted` that sits after `n` digits/decimal chars. */
function caretAfterAmountChars(formatted: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9.]/.test(formatted[i])) seen++;
    if (seen === n) return i + 1;
  }
  return formatted.length;
}

/**
 * Amount input adorned with the account's currency symbol ("₹ 1500").
 * Composes the master Input — the symbol is a pointer-transparent
 * overlay and the input gains left padding sized to the symbol, so all
 * Input styling/behaviour (focus ring, disabled, invalid) is inherited
 * untouched. Pass the symbol from `currencySymbol(defaultCurrency)`.
 *
 * Two modes:
 * - **plain** (default) — a `type="number"` field; `value` / `onChange`
 *   behave like any Input.
 * - **grouped** — pass `groupLocale` (the account's BCP-47 tag, from
 *   `useLocale().locale.locale`) and `onValueChange`. The field becomes
 *   `type="text"` (a number input can't render separators) and displays
 *   the amount grouped for that locale — Indian lakh grouping for en-IN,
 *   thousands elsewhere — while `onValueChange` still hands back the RAW
 *   numeric string ("100000"), so callers keep storing plain numbers.
 *   The caret is restored by digit position, so typing mid-number doesn't
 *   jump to the end when a separator appears.
 */
function CurrencyInput({
  symbol,
  className,
  groupLocale,
  onValueChange,
  value,
  ...props
}: Omit<React.ComponentProps<"input">, "onChange"> & {
  symbol: string;
  /** BCP-47 tag — presence switches the field into grouped mode. */
  groupLocale?: string;
  /** Grouped mode: the raw (unseparated) amount string. */
  onValueChange?: (raw: string) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  // Bucketed padding: 1-char symbols (₹ $ €) sit in pl-7; wider ones
  // (A$, د.إ) get progressively more room. Class-only so Tailwind can
  // see every variant.
  const pad =
    symbol.length <= 1 ? "pl-7" : symbol.length === 2 ? "pl-9" : "pl-12";

  const grouped = !!groupLocale;
  const raw = value == null ? "" : String(value);

  // Rewrite the DOM value to the grouped form in place and restore the
  // caret, then report the raw value up. React re-renders with the same
  // string, so it won't touch (or reset) the caret.
  const handleGroupedChange: React.ChangeEventHandler<HTMLInputElement> = (
    e,
  ) => {
    const el = e.currentTarget;
    const caret = el.selectionStart ?? el.value.length;
    const before = countAmountChars(el.value.slice(0, caret));
    const next = sanitizeAmount(el.value);
    const formatted = groupAmount(next, groupLocale!);
    el.value = formatted;
    const pos = caretAfterAmountChars(formatted, before);
    el.setSelectionRange(pos, pos);
    onValueChange?.(next);
  };

  return (
    <div className="relative w-full min-w-0">
      <span
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm"
      >
        {symbol}
      </span>
      {grouped ? (
        <Input
          type="text"
          inputMode="decimal"
          {...props}
          value={groupAmount(raw, groupLocale!)}
          onChange={handleGroupedChange}
          className={cn(pad, className)}
        />
      ) : (
        <Input type="number" value={value} {...props} className={cn(pad, className)} />
      )}
    </div>
  );
}

export { CurrencyInput };
