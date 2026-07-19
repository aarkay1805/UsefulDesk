'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type SearchInputProps = Omit<
  React.ComponentProps<'input'>,
  'defaultValue' | 'onChange' | 'ref' | 'type' | 'value'
> & {
  containerClassName?: string;
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
};

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

/**
 * SearchInput — the single source of truth for a search field anywhere in
 * the product (page/table toolbars, dialog pickers, the inbox list). A
 * leading search glyph over a **rounded-rectangle** `Input` with the
 * defined `border-border` token and a muted fill. It is controlled by
 * `value` / `onValueChange`; typing, the trailing clear button, and Escape
 * all report through that same value contract.
 *
 * Width/flex live on the wrapper via `containerClassName`
 * (e.g. "max-w-xs flex-1 basis-52"); the radius, border, icon, and padding
 * are fixed here — never restyle those per call-site, that drift is exactly
 * what this component exists to kill. `className` still forwards to the
 * inner input for the rare one-off (an override wins via tailwind-merge),
 * but reach for it sparingly. The clear action appears only for an editable,
 * non-empty field and returns focus to the input.
 */
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      className,
      containerClassName,
      value,
      onValueChange,
      clearLabel = 'Clear search',
      disabled,
      readOnly,
      onKeyDown,
      enterKeyHint = 'search',
      'aria-label': ariaLabel,
      ...props
    },
    forwardedRef
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const setInputRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef]
    );

    const clear = () => {
      if (disabled || readOnly || value.length === 0) return;
      onValueChange('');
      inputRef.current?.focus();
    };

    return (
      <div className={cn('relative', containerClassName)}>
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          {...props}
          ref={setInputRef}
          type="search"
          enterKeyHint={enterKeyHint}
          aria-label={ariaLabel ?? 'Search'}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          data-slot="search-input"
          className={cn(
            'border-border bg-muted pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
            className
          )}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (
              !event.defaultPrevented &&
              event.key === 'Escape' &&
              value.length > 0 &&
              !disabled &&
              !readOnly
            ) {
              event.preventDefault();
              clear();
            }
          }}
        />
        {value.length > 0 && !disabled && !readOnly && (
          <div className="absolute inset-y-0 right-1 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-slot="search-input-clear"
              aria-label={clearLabel}
              onClick={clear}
            >
              <X />
            </Button>
          </div>
        )}
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';

export { SearchInput, type SearchInputProps };
