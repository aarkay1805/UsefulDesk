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
    for (const message of [
      'Failed to fetch',
      'Load failed',
      'fetch failed',
      'NetworkError when attempting to fetch resource.',
      'Network request failed',
      'net::ERR_INTERNET_DISCONNECTED',
    ]) {
      expect(getErrorMessage(new TypeError(message), 'Fallback')).toBe(
        'No internet connection. Check your internet and try again.'
      );
    }
  });

  it('turns Supabase-wrapped browser network failures into plain language', () => {
    for (const message of [
      'TypeError: Failed to fetch',
      'TypeError: Load failed',
      'FetchError: fetch failed',
    ]) {
      expect(getErrorMessage({ code: '', message }, 'Fallback')).toBe(
        'No internet connection. Check your internet and try again.'
      );
    }
  });

  it('keeps provider failure details instead of reporting no internet', () => {
    for (const message of [
      'Resumable upload failed: 413',
      'Media download failed: 404',
      'Media fetch failed: 404',
      'TypeError: Resumable upload failed: 413',
      'FetchError: Media download failed: 404',
    ]) {
      expect(getErrorMessage(new Error(message), 'Fallback')).toBe(message);
    }
  });

  it('uses the caller fallback for a technical failure containing network words', () => {
    expect(
      getErrorMessage(
        { code: 'PGRST202', message: 'Media download failed: 404' },
        'Could not download the file'
      )
    ).toBe('Could not download the file');
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
