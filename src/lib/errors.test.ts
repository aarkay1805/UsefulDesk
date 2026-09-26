import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns a native Error message', () => {
    expect(getErrorMessage(new Error('Network unavailable'), 'Fallback')).toBe(
      'Network unavailable'
    );
  });

  it('returns a plain-object message written for people', () => {
    expect(
      getErrorMessage({ message: 'This plan is archived' }, 'Fallback')
    ).toBe('This plan is archived');
  });

  it('uses the fallback for a developer-only database message', () => {
    expect(
      getErrorMessage(
        { code: 'PGRST202', message: 'Database function is unavailable' },
        'Fallback'
      )
    ).toBe('Fallback');
    expect(
      getErrorMessage(
        {
          code: '23514',
          message: 'new row violates check constraint "fee_positive"',
        },
        'Fallback'
      )
    ).toBe('Fallback');
  });

  it('uses the fallback when no useful message exists', () => {
    expect(getErrorMessage({ message: ' ' }, 'Fallback')).toBe('Fallback');
  });

  it('turns browser network failures into plain language', () => {
    expect(getErrorMessage(new TypeError('Failed to fetch'), 'Fallback')).toBe(
      'No internet connection. Check your internet and try again.'
    );
  });

  it('turns permission failures into plain language', () => {
    expect(
      getErrorMessage(
        {
          code: '42501',
          message: 'new row violates row-level security policy for table "x"',
        },
        'Fallback'
      )
    ).toBe('You do not have permission to do this. Ask the owner or an admin.');
  });

  it('turns duplicate and expired-login failures into plain language', () => {
    expect(
      getErrorMessage(
        { code: '23505', message: 'duplicate key value violates unique' },
        'Fallback'
      )
    ).toBe('This already exists.');
    expect(getErrorMessage(new Error('JWT expired'), 'Fallback')).toBe(
      'Your login has expired. Log in again.'
    );
  });
});
