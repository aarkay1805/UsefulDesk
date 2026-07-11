import { describe, expect, it } from 'vitest';
import {
  COUNTRY_OPTIONS,
  COUNTRY_PRESETS,
  DEFAULT_ACCOUNT_LOCALE,
  importDateOrder,
  isValidLocaleTag,
  isValidTimeZone,
  presetFor,
  resolveAccountLocale,
  toAccountColumns,
} from './config';

describe('COUNTRY_PRESETS', () => {
  it('every preset carries values the runtime Intl accepts', () => {
    for (const [code, p] of Object.entries(COUNTRY_PRESETS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(isValidLocaleTag(p.locale), `${code} locale`).toBe(true);
      expect(isValidTimeZone(p.timeZone), `${code} timeZone`).toBe(true);
      expect(p.currency).toMatch(/^[A-Z]{3}$/);
      // Intl must know the currency (it's lenient, but must not throw).
      expect(() =>
        new Intl.NumberFormat(p.locale, {
          style: 'currency',
          currency: p.currency,
        }).format(1)
      ).not.toThrow();
      if (code === 'ZZ') expect(p.phoneCountryCode).toBe('');
      else expect(p.phoneCountryCode).toMatch(/^\+[0-9]{1,4}$/);
      if (p.timeZones) expect(p.timeZones).toContain(p.timeZone);
    }
  });

  it('orders the picker India-first, unlisted last', () => {
    expect(COUNTRY_OPTIONS[0].code).toBe('IN');
    expect(COUNTRY_OPTIONS[COUNTRY_OPTIONS.length - 1].code).toBe('ZZ');
  });

  it('presetFor falls back to India for unknown codes', () => {
    expect(presetFor('XX')).toEqual(DEFAULT_ACCOUNT_LOCALE);
    expect(presetFor('US').currency).toBe('USD');
    expect(presetFor('US').countryCode).toBe('US');
  });
});

describe('resolveAccountLocale', () => {
  it('returns the India default for null / empty rows', () => {
    expect(resolveAccountLocale(null)).toEqual(DEFAULT_ACCOUNT_LOCALE);
    expect(resolveAccountLocale({})).toEqual(DEFAULT_ACCOUNT_LOCALE);
    expect(DEFAULT_ACCOUNT_LOCALE.timeZone).toBe('Asia/Kolkata');
    expect(DEFAULT_ACCOUNT_LOCALE.currency).toBe('INR');
  });

  it('narrows a full valid row', () => {
    const cfg = resolveAccountLocale({
      country_code: 'US',
      locale: 'en-US',
      default_currency: 'USD',
      timezone: 'America/Chicago',
      date_order: 'MDY',
      time_format: '12h',
      week_start: 0,
      phone_country_code: '+1',
      measurement_system: 'imperial',
    });
    expect(cfg).toEqual({
      countryCode: 'US',
      locale: 'en-US',
      currency: 'USD',
      timeZone: 'America/Chicago',
      dateOrder: 'MDY',
      timeFormat: '12h',
      weekStart: 0,
      phoneCountryCode: '+1',
      measurementSystem: 'imperial',
    });
  });

  it('falls back per-field on malformed values', () => {
    const cfg = resolveAccountLocale({
      country_code: 'usa',
      locale: 'not a tag',
      default_currency: 'rupees',
      timezone: 'Mars/Olympus_Mons',
      date_order: 'XYZ',
      time_format: '13h',
      week_start: 3,
      phone_country_code: '91',
      measurement_system: 'furlongs',
    });
    expect(cfg).toEqual(DEFAULT_ACCOUNT_LOCALE);
  });

  it("keeps an empty phone code (the 'ZZ' preset)", () => {
    expect(
      resolveAccountLocale({ phone_country_code: '' }).phoneCountryCode
    ).toBe('');
  });
});

describe('toAccountColumns', () => {
  it('round-trips through resolveAccountLocale', () => {
    for (const code of Object.keys(COUNTRY_PRESETS)) {
      const cfg = presetFor(code);
      expect(resolveAccountLocale(toAccountColumns(cfg))).toEqual(cfg);
    }
  });
});

describe('importDateOrder', () => {
  it('maps YMD and MDY to month-first, everything else day-first', () => {
    expect(importDateOrder(presetFor('IN'))).toBe('DMY');
    expect(importDateOrder(presetFor('US'))).toBe('MDY');
    expect(importDateOrder(presetFor('CA'))).toBe('MDY');
    expect(importDateOrder(presetFor('GB'))).toBe('DMY');
  });
});
