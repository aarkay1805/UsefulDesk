import * as React from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * SearchInput — the single source of truth for a search field anywhere in
 * the product (page/table toolbars, dialog pickers, the inbox list). A
 * leading search glyph over a **rounded-rectangle** `Input` with the
 * defined `border-border` token and a muted fill.
 *
 * Width/flex live on the wrapper via `containerClassName`
 * (e.g. "max-w-xs flex-1 basis-52"); the radius, border, icon, and padding
 * are fixed here — never restyle those per call-site, that drift is exactly
 * what this component exists to kill. `className` still forwards to the
 * inner input for the rare one-off (an override wins via tailwind-merge),
 * but reach for it sparingly.
 */
function SearchInput({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"input"> & { containerClassName?: string }) {
  return (
    <div className={cn("relative", containerClassName)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        data-slot="search-input"
        className={cn("border-border bg-muted pl-8", className)}
        {...props}
      />
    </div>
  );
}

export { SearchInput };
