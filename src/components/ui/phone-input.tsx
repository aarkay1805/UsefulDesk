'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { useLocale } from '@/hooks/use-locale';
import {
  accountQualifiedPhoneValue,
  nationalPhoneInputValue,
} from '@/lib/phone-input';
import { cn } from '@/lib/utils';

type PhoneInputProps = Omit<
  React.ComponentProps<'input'>,
  'type' | 'inputMode' | 'value' | 'defaultValue' | 'onChange'
> & {
  /** Complete account-qualified value used by persistence and dedupe. */
  value?: string;
  /** Complete account-qualified initial value for compact uncontrolled editors. */
  defaultValue?: string;
  /** Reports the complete account-qualified phone, not just the visible national part. */
  onValueChange?: (phone: string) => void;
  /** Public forms pass the account code fetched by their token-scoped config. */
  countryCode?: string;
};

/**
 * Phone-number input with the account's localization country code in a
 * fixed, non-editable leading compartment. The DOM field shows only the
 * national-number portion; `value`, `defaultValue`, and `onValueChange`
 * use the complete account-qualified phone so persistence and dedupe paths
 * never need to reconstruct it themselves.
 */
function PhoneInput({
  className,
  countryCode,
  value,
  defaultValue,
  onValueChange,
  'aria-describedby': ariaDescribedBy,
  ...props
}: PhoneInputProps) {
  const { locale } = useLocale();
  const descriptionId = React.useId();
  const normalizedCountryCode = (countryCode ?? locale.phoneCountryCode).trim();
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
        value={
          value === undefined
            ? undefined
            : nationalPhoneInputValue(value, normalizedCountryCode)
        }
        defaultValue={
          defaultValue === undefined
            ? undefined
            : nationalPhoneInputValue(defaultValue, normalizedCountryCode)
        }
        onChange={(event) =>
          onValueChange?.(
            accountQualifiedPhoneValue(
              event.currentTarget.value,
              normalizedCountryCode
            )
          )
        }
        aria-describedby={describedBy}
        className={cn('pl-16', className)}
      />
    </div>
  );
}

export { PhoneInput };
export type { PhoneInputProps };
