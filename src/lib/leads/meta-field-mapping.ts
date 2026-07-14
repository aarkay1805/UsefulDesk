// ============================================================
// Meta lead-ad field_data → a contact.
//
// Meta's standard prefill questions have stable keys (full_name,
// phone_number, email). CUSTOM questions do not: the key is derived from
// the question text the gym typed into Ads Manager, so it can be
// anything — "what_is_your_goal?", "aap_ka_lakshya_kya_hai", or a
// hash-suffixed variant. A hard-coded key lookup would silently drop
// the phone number of every gym that phrased its question differently,
// and we would never hear about it — the lead just never arrives.
//
// So: three tiers, most-specific first.
//   1. normalize the key   (case/punctuation collapse)
//   2. an ordered alias table
//   3. a SHAPE fallback    (looks like an email / looks like a phone)
//
// Everything unmatched is preserved in order and written to the lead's
// note, so a question we failed to map is still visible to the gym
// rather than thrown away.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { MetaFieldDatum } from '@/lib/whatsapp/meta-api';

export interface MappedMetaLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Answers that mapped to no contact field, in Meta's original order. */
  extras: { label: string; value: string }[];
}

/** 'Phone Number?' / 'phone_number' / 'phoneNumber' → 'phonenumber'. */
function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const PHONE_ALIASES = new Set([
  'phonenumber',
  'phone',
  'mobile',
  'mobilenumber',
  'mobileno',
  'contactnumber',
  'whatsapp',
  'whatsappnumber',
]);

const EMAIL_ALIASES = new Set(['email', 'emailaddress', 'workemail']);
const FULLNAME_ALIASES = new Set(['fullname', 'name']);
const FIRSTNAME_ALIASES = new Set(['firstname', 'givenname']);
const LASTNAME_ALIASES = new Set(['lastname', 'surname', 'familyname']);

/** "what_is_your_goal" → "What is your goal". */
function humanise(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function looksLikePhone(value: string): boolean {
  // 8+ digits, and not overwhelmingly non-numeric (so a long free-text
  // answer that happens to contain a year doesn't get read as a phone).
  const digits = normalizePhone(value);
  return digits.length >= 8 && digits.length >= value.trim().length / 2;
}

export function mapMetaLeadFields(fieldData: MetaFieldDatum[]): MappedMetaLead {
  let name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;

  const unmatched: MetaFieldDatum[] = [];

  // Tier 1 + 2 — key normalization, then the alias table.
  for (const field of fieldData) {
    const value = (field.values ?? []).find((v) => v && v.trim() !== '')?.trim();
    if (!value) continue;

    const key = normalizeKey(field.name ?? '');

    if (!phone && PHONE_ALIASES.has(key)) {
      phone = value;
    } else if (!email && EMAIL_ALIASES.has(key)) {
      email = value;
    } else if (!name && FULLNAME_ALIASES.has(key)) {
      name = value;
    } else if (!firstName && FIRSTNAME_ALIASES.has(key)) {
      firstName = value;
    } else if (!lastName && LASTNAME_ALIASES.has(key)) {
      lastName = value;
    } else {
      unmatched.push(field);
    }
  }

  if (!name) {
    const joined = [firstName, lastName].filter(Boolean).join(' ').trim();
    name = joined || null;
  }

  // Tier 3 — shape. Only for fields no alias claimed, and only to fill a
  // slot that is still empty. This is what saves a gym whose phone
  // question is titled in Hindi.
  const extras: { label: string; value: string }[] = [];
  for (const field of unmatched) {
    const value = (field.values ?? []).find((v) => v && v.trim() !== '')?.trim();
    if (!value) continue;

    if (!email && looksLikeEmail(value)) {
      email = value;
      continue;
    }
    if (!phone && looksLikePhone(value)) {
      phone = value;
      continue;
    }
    extras.push({ label: humanise(field.name ?? ''), value });
  }

  return { name, phone, email, extras };
}
