// ============================================================
// Public capture form — pure validation.
//
// Run by BOTH the /f/<token> page (to show inline errors) and the
// submit route (because UI validation is convenience, not
// authorization — the route is a public, unauthenticated write and
// must assume the client is hostile).
//
// Hand-rolled, no zod: the house style is a pure guard returning a
// union, colocated with a test (see src/lib/payments/validation.ts).
// ============================================================

import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { GOAL_OPTIONS } from '@/lib/leads/attributes';

export interface CaptureFormInput {
  name: string;
  phone: string;
  email: string;
  goal: string;
  source: string;
  consent: boolean;
  /** Honeypot. A real browser leaves this empty; a bot fills every
   *  field it finds. Checked by the route, not here — a bot must never
   *  learn which field trapped it. */
  website?: string;
}

export type CaptureFieldError =
  | 'name_required'
  | 'phone_required'
  | 'phone_invalid'
  | 'email_invalid'
  | 'goal_invalid'
  | 'source_invalid'
  | 'consent_required';

export interface CaptureFormContext {
  /** The account's dial code from the peek payload, e.g. '+91'. May be
   *  '' when the gym has no country configured. */
  dialCode: string;
  /** Source keys the account actually offers (its lead_field_options,
   *  falling back to SOURCE_OPTIONS). A submission may not invent one. */
  sourceKeys: string[];
}

export interface CaptureFormValue {
  name: string;
  /** Digits-only, dial-code qualified — ready for contacts.phone. */
  phone: string;
  email: string | null;
  goal: string;
  source: string;
}

export type CaptureFormResult =
  | { ok: true; value: CaptureFormValue }
  | { ok: false; errors: CaptureFieldError[] };

const GOAL_KEYS = new Set(GOAL_OPTIONS.map((o) => o.value));

// Deliberately permissive. The point is to reject a typo like
// "priya@gmail" before it becomes an unreachable lead, NOT to police
// RFC 5322 — a form that rejects a valid address is worse than one
// that accepts a bounced one, because the lead is lost either way and
// this way the gym never even hears about it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn what a human typed into a dial-code-qualified, digits-only phone.
 *
 * THE TRAP THIS EXISTS TO CLOSE: a visitor types their 10 local digits,
 * "9876543210". `isValidE164` happily accepts that (7–15 digits, leading
 * non-zero), so it stores looking perfectly clean — and is then
 * un-messageable on WhatsApp forever. The lead enters the funnel and
 * every renewal reminder, every follow-up, silently never arrives. That
 * breaks the entire wedge, and it fails in the one direction nobody
 * checks: the happy path.
 *
 * So: prefix the account's dial code unless the input is explicitly
 * international. Reused by the Meta leadgen path, where a *manually
 * typed* answer in a lead form is raw text and just as likely to be
 * 10 bare digits (Meta only auto-prefills the +91 form from the
 * profile). Meta's "p:" prefix needs no special handling — the digit
 * strip eats it.
 *
 * Returns null when there is nothing usable.
 */
export function normalizeSubmittedPhone(
  raw: string,
  dialCode: string
): string | null {
  const trimmed = raw.trim();
  const digits = normalizePhone(trimmed);
  if (!digits) return null;

  // Explicitly international — the visitor told us the country.
  if (trimmed.startsWith('+') || digits.startsWith('00')) {
    return digits.replace(/^00/, '');
  }

  const cc = normalizePhone(dialCode); // '+91' → '91'
  const local = digits.replace(/^0+/, ''); // drop the domestic trunk 0
  if (!local) return null;
  if (!cc) return local; // account has no country configured

  // Does it already carry the dial code? Only trust that when what's
  // left is still a plausible subscriber number. Without the length
  // guard, the perfectly real Indian number '9198765432' would be read
  // as country code 91 + subscriber '98765432' and silently mangled.
  if (local.startsWith(cc) && local.length - cc.length >= 9) return local;

  return cc + local;
}

/** Validate a capture-form submission. Errors accumulate so the page can
 *  mark every bad field at once rather than one per round-trip. */
export function validateCaptureSubmission(
  input: CaptureFormInput,
  ctx: CaptureFormContext
): CaptureFormResult {
  const errors: CaptureFieldError[] = [];

  const name = input.name.trim();
  if (!name) errors.push('name_required');

  const rawPhone = input.phone.trim();
  let phone: string | null = null;
  if (!rawPhone) {
    errors.push('phone_required');
  } else {
    phone = normalizeSubmittedPhone(rawPhone, ctx.dialCode);
    if (!phone || !isValidE164(phone)) errors.push('phone_invalid');
  }

  const email = input.email.trim();
  if (email && !EMAIL_RE.test(email)) errors.push('email_invalid');

  // Goal and source are optional to answer, but if answered must be a
  // key we offer — otherwise a crafted payload could mint arbitrary
  // tags (goal) or arbitrary source values (which are free-text in the
  // DB and would pollute the gym's own curated list).
  const goal = input.goal.trim();
  if (goal && !GOAL_KEYS.has(goal)) errors.push('goal_invalid');

  const source = input.source.trim();
  if (source && !ctx.sourceKeys.includes(source)) errors.push('source_invalid');

  if (!input.consent) errors.push('consent_required');

  if (errors.length > 0 || !phone) return { ok: false, errors };

  return {
    ok: true,
    value: { name, phone, email: email || null, goal, source },
  };
}

/** Human copy for an error key — shared by the page and any surface that
 *  needs to render what the route rejected. */
export function captureErrorMessage(error: CaptureFieldError): string {
  switch (error) {
    case 'name_required':
      return 'Please enter your name';
    case 'phone_required':
      return 'Please enter your phone number';
    case 'phone_invalid':
      return 'That does not look like a valid phone number';
    case 'email_invalid':
      return 'That does not look like a valid email address';
    case 'goal_invalid':
      return 'Please pick a goal from the list';
    case 'source_invalid':
      return 'Please pick an option from the list';
    case 'consent_required':
      return 'Please agree to be contacted so we can reply';
  }
}
