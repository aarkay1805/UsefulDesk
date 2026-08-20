// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PhoneInput } from './phone-input';

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ locale: { phoneCountryCode: '+1' } }),
}));

describe('PhoneInput', () => {
  afterEach(cleanup);

  it('shows a canonical plus-prefixed code without changing its emitted value contract', () => {
    const onValueChange = vi.fn();

    render(
      <PhoneInput
        aria-label="Phone"
        countryCode="91"
        value="919876543210"
        onValueChange={onValueChange}
      />
    );

    expect(screen.getByText('+91')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Phone' }) as HTMLInputElement).value
    ).toBe('9876543210');

    fireEvent.change(screen.getByRole('textbox', { name: 'Phone' }), {
      target: { value: '9988776655' },
    });

    expect(onValueChange).toHaveBeenCalledWith('919988776655');
  });
});
