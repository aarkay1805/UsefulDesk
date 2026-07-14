import { describe, it, expect } from 'vitest';

import {
  normalizeSubmittedPhone,
  validateCaptureSubmission,
  type CaptureFormInput,
  type CaptureFormContext,
} from './capture-form';

const IN: CaptureFormContext = {
  dialCode: '+91',
  sourceKeys: ['walk_in', 'instagram', 'referral'],
};

function submission(over: Partial<CaptureFormInput> = {}): CaptureFormInput {
  return {
    name: 'Priya Sharma',
    phone: '9876543210',
    email: '',
    goal: 'weight_loss',
    source: 'instagram',
    consent: true,
    ...over,
  };
}

describe('normalizeSubmittedPhone', () => {
  it('prefixes the account dial code onto a bare local number', () => {
    // The whole reason this function exists: isValidE164 would accept
    // the bare 10 digits, and the lead would be unmessageable forever.
    expect(normalizeSubmittedPhone('9876543210', '+91')).toBe('919876543210');
  });

  it('strips the domestic trunk 0 before prefixing', () => {
    expect(normalizeSubmittedPhone('09876543210', '+91')).toBe('919876543210');
  });

  it('keeps an explicitly international number as typed', () => {
    expect(normalizeSubmittedPhone('+91 98765 43210', '+91')).toBe('919876543210');
    expect(normalizeSubmittedPhone('+1 415 555 0123', '+91')).toBe('14155550123');
    expect(normalizeSubmittedPhone('0091 98765 43210', '+91')).toBe('919876543210');
  });

  it('does not double-prefix a number that already carries the dial code', () => {
    expect(normalizeSubmittedPhone('919876543210', '+91')).toBe('919876543210');
  });

  it('THE TRAP: a local number that merely starts with the dial code', () => {
    // '9198765432' is a real 10-digit Indian subscriber number that
    // happens to begin '91'. Naively trusting the prefix would read it
    // as +91 followed by an 8-digit stub and mangle it. The length
    // guard must treat it as local and prefix it.
    expect(normalizeSubmittedPhone('9198765432', '+91')).toBe('919198765432');
  });

  it("handles Meta's p: prefix, which the digit strip eats", () => {
    expect(normalizeSubmittedPhone('p:+919876543210', '+91')).toBe('919876543210');
  });

  it('passes the number through when the account has no dial code', () => {
    expect(normalizeSubmittedPhone('9876543210', '')).toBe('9876543210');
  });

  it('returns null for input with no digits', () => {
    expect(normalizeSubmittedPhone('', '+91')).toBeNull();
    expect(normalizeSubmittedPhone('   ', '+91')).toBeNull();
    expect(normalizeSubmittedPhone('call me!', '+91')).toBeNull();
    expect(normalizeSubmittedPhone('0', '+91')).toBeNull();
  });
});

describe('validateCaptureSubmission', () => {
  it('accepts a good submission and returns the qualified phone', () => {
    const result = validateCaptureSubmission(submission(), IN);
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Priya Sharma',
        phone: '919876543210',
        email: null,
        goal: 'weight_loss',
        source: 'instagram',
      },
    });
  });

  it('trims the name and normalizes an empty email to null', () => {
    const result = validateCaptureSubmission(
      submission({ name: '  Priya  ', email: '   ' }),
      IN
    );
    expect(result.ok && result.value.name).toBe('Priya');
    expect(result.ok && result.value.email).toBeNull();
  });

  it('requires a name, a phone and consent', () => {
    const result = validateCaptureSubmission(
      submission({ name: '', phone: '', consent: false }),
      IN
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual(
      expect.arrayContaining(['name_required', 'phone_required', 'consent_required'])
    );
  });

  it('rejects consent that was not given, even when everything else is valid', () => {
    // The lead is worthless if we may not contact them, and storing it
    // anyway is the DPDP problem this whole audit trail exists to avoid.
    const result = validateCaptureSubmission(submission({ consent: false }), IN);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContain('consent_required');
  });

  it('rejects an unparseable phone', () => {
    const result = validateCaptureSubmission(submission({ phone: 'call me' }), IN);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContain('phone_invalid');
  });

  it('rejects a malformed email but allows an absent one', () => {
    expect(
      validateCaptureSubmission(submission({ email: 'priya@gmail' }), IN).ok
    ).toBe(false);
    expect(validateCaptureSubmission(submission({ email: '' }), IN).ok).toBe(true);
    expect(
      validateCaptureSubmission(submission({ email: 'priya@gmail.com' }), IN).ok
    ).toBe(true);
  });

  it('rejects a goal that is not one we offer', () => {
    // A crafted payload must not be able to mint arbitrary tags.
    const result = validateCaptureSubmission(
      submission({ goal: 'free_protein_shakes' }),
      IN
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContain('goal_invalid');
  });

  it("rejects a source outside the account's own list", () => {
    // contacts.source is free text in the DB — without this guard a
    // crafted payload would pollute the gym's curated source list.
    const result = validateCaptureSubmission(
      submission({ source: 'spam_injected_source' }),
      IN
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContain('source_invalid');
  });

  it('allows goal and source to be left unanswered', () => {
    const result = validateCaptureSubmission(
      submission({ goal: '', source: '' }),
      IN
    );
    expect(result.ok).toBe(true);
  });

  it('accumulates every error rather than stopping at the first', () => {
    const result = validateCaptureSubmission(
      submission({ name: '', email: 'nope', goal: 'bogus', consent: false }),
      IN
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
