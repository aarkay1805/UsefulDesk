import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Amount input adorned with the account's currency symbol ("₹ 1500").
 * Composes the master Input — the symbol is a pointer-transparent
 * overlay and the input gains left padding sized to the symbol, so all
 * Input styling/behaviour (focus ring, disabled, invalid) is inherited
 * untouched. Pass the symbol from `currencySymbol(defaultCurrency)`.
 */
function CurrencyInput({
  symbol,
  className,
  ...props
}: React.ComponentProps<"input"> & { symbol: string }) {
  // Bucketed padding: 1-char symbols (₹ $ €) sit in pl-7; wider ones
  // (A$, د.إ) get progressively more room. Class-only so Tailwind can
  // see every variant.
  const pad =
    symbol.length <= 1 ? "pl-7" : symbol.length === 2 ? "pl-9" : "pl-12";
  return (
    <div className="relative w-full min-w-0">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
      >
        {symbol}
      </span>
      <Input type="number" {...props} className={cn(pad, className)} />
    </div>
  );
}

export { CurrencyInput };
