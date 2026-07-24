import { describe, expect, it } from 'vitest';
import { presetFor } from './config';
import {
  buildFormatters,
  dateAtNoonInTz,
  DEFAULT_FORMATTERS,
  hourInTz,
  todayInTz,
} from './format';

const IN = buildFormatters(presetFor('IN'));
const US = buildFormatters(presetFor('US'));
const CA = buildFormatters(presetFor('CA'));

describe('todayInTz', () => {
  it('matches the IST day boundary (18:30 UTC rollover)', () => {
    expect(todayInTz('Asia/Kolkata', new Date('2026-07-03T18:29:00Z'))).toBe(
      '2026-07-03'
    );
    expect(todayInTz('Asia/Kolkata', new Date('2026-07-03T18:30:00Z'))).toBe(
      '2026-07-04'
    );
  });

  it('handles a DST zone (New York, EDT = UTC-4 in July)', () => {
    expect(
      todayInTz('America/New_York', new Date('2026-07-04T03:59:00Z'))
    ).toBe('2026-07-03');
    expect(
      todayInTz('America/New_York', new Date('2026-07-04T04:00:00Z'))
    ).toBe('2026-07-04');
  });

  it('falls back to UTC on an unknown zone instead of throwing', () => {
    expect(todayInTz('Not/A_Zone', new Date('2026-07-04T01:00:00Z'))).toBe(
      '2026-07-04'
    );
  });
});

describe('hourInTz', () => {
  it('reads the local hour', () => {
    // 03:30 UTC = 09:00 IST.
    expect(hourInTz('Asia/Kolkata', new Date('2026-07-04T03:30:00Z'))).toBe(9);
    // 13:30 UTC = 09:30 EDT.
    expect(hourInTz('America/New_York', new Date('2026-07-04T13:30:00Z'))).toBe(
      9
    );
  });
});

describe('dateAtNoonInTz', () => {
  it('lands on the picked day in the zone, even beyond UTC+12', () => {
    for (const tz of [
      'Asia/Kolkata',
      'America/Los_Angeles',
      'Pacific/Auckland', // UTC+13 in January — the noon-UTC anchor breaks here
    ]) {
      const instant = dateAtNoonInTz('2026-01-15', tz)!;
      expect(todayInTz(tz, instant)).toBe('2026-01-15');
    }
  });

  it('returns null on malformed input', () => {
    expect(dateAtNoonInTz('15/01/2026', 'Asia/Kolkata')).toBeNull();
  });
});

describe('date (medium)', () => {
  it('follows the locale order for plain dates', () => {
    expect(IN.date('2026-07-11')).toBe('11 Jul 2026');
    expect(US.date('2026-07-11')).toBe('Jul 11, 2026');
  });

  it('never day-shifts a plain date', () => {
    // Formatted from parts — identical in any runtime zone.
    expect(IN.date('2026-01-01')).toBe('1 Jan 2026');
    expect(US.date('2026-12-31')).toBe('Dec 31, 2026');
  });

  it('renders timestamps in the ACCOUNT zone', () => {
    // 20:00 UTC = 01:30 next day IST, still same day in New York.
    const ts = '2026-07-11T20:00:00Z';
    expect(IN.date(ts)).toBe('12 Jul 2026');
    expect(US.date(ts)).toBe('Jul 11, 2026');
  });

  it('echoes unparseable input', () => {
    expect(IN.date('soon')).toBe('soon');
  });
});

describe('month', () => {
  it('renders a calendar month without day text', () => {
    expect(IN.month('2026-07-01')).toBe('July 2026');
    expect(US.month('2026-07-01')).toBe('July 2026');
    expect(IN.monthName('2026-07-01')).toBe('July');
    expect(US.monthName('2026-07-01')).toBe('July');
  });
});

describe('dateShort', () => {
  it('follows dateOrder', () => {
    expect(IN.dateShort('2026-07-11')).toBe('11/07/2026');
    expect(US.dateShort('2026-07-11')).toBe('07/11/2026');
    expect(CA.dateShort('2026-07-11')).toBe('2026-07-11');
  });

  it('resolves timestamps in the account zone first', () => {
    expect(IN.dateShort('2026-07-11T20:00:00Z')).toBe('12/07/2026');
    expect(US.dateShort('2026-07-11T20:00:00Z')).toBe('07/11/2026');
  });
});

describe('time / dateTime', () => {
  const ts = '2026-07-11T15:30:00Z'; // 21:00 IST, 11:30 EDT
  it('honours the 12h/24h preference in the account zone', () => {
    expect(IN.time(ts).toLowerCase()).toContain('9:00');
    expect(IN.time(ts).toLowerCase()).toContain('pm');
    const gb24 = buildFormatters({
      ...presetFor('GB'),
      timeFormat: '24h',
    });
    expect(gb24.time(ts)).toBe('16:30'); // BST = UTC+1
  });

  it('dateTime falls back to date() for plain dates', () => {
    expect(IN.dateTime('2026-07-11')).toBe('11 Jul 2026');
    expect(IN.time('2026-07-11')).toBe('');
  });
});

describe('number / money', () => {
  it('groups per locale — lakh for en-IN, thousands for en-US', () => {
    expect(IN.number(100000)).toBe('1,00,000');
    expect(US.number(100000)).toBe('100,000');
  });

  it('money uses the account currency + locale grouping', () => {
    expect(IN.money(100000).replace(/ /g, '')).toBe('₹1,00,000');
    expect(US.money(100000).replace(/ /g, '')).toBe('$100,000');
  });

  it('money accepts a per-value currency override', () => {
    expect(IN.money(500, 'USD')).toContain('500');
    expect(IN.money(500, 'USD')).toContain('$');
  });

  it('DEFAULT_FORMATTERS is India-shaped', () => {
    expect(DEFAULT_FORMATTERS.config.currency).toBe('INR');
    expect(DEFAULT_FORMATTERS.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
