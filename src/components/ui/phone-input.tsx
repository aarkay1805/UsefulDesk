'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

type PhoneInputProps = Omit<
  React.ComponentProps<'input'>,
  'type' | 'inputMode'
>;

/**
 * Phone-number input with the account's localization country code in a
 * fixed, non-editable leading compartment. The editable value is passed
 * through unchanged; parsing, normalization, and persistence remain the
 * caller's responsibility.
 */
function PhoneInput({
  className,
  'aria-describedby': ariaDescribedBy,
  ...props
}: PhoneInputProps) {
  const { locale } = useLocale();
  const descriptionId = React.useId();
  const normalizedCountryCode = locale.phoneCountryCode.trim();
  const displayCountryCode = normalizedCountryCode || '—';
  const describedBy = [ariaDescribedBy, descriptionId]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="relative w-full min-w-0">
      <span
        aria-hidden="true"
        className="bg-muted/40 text-muted-foreground border-border pointer-events-none absolute inset-y-px left-px z-10 flex w-14 items-center justify-center rounded-l-lg border-r text-sm tabular-nums select-none"
      >
        {displayCountryCode}
      </span>
      <span id={descriptionId} className="sr-only">
        {normalizedCountryCode
          ? `Country code ${normalizedCountryCode}, set in Localization settings.`
          : 'No country code is set. Configure it in Localization settings.'}
      </span>
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        {...props}
        aria-describedby={describedBy}
        className={cn('pl-16', className)}
      />
    </div>
  );
}

export { PhoneInput };
export type { PhoneInputProps };
