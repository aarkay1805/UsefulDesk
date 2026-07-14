import { describe, it, expect } from 'vitest';

import { mapMetaLeadFields } from './meta-field-mapping';

const f = (name: string, ...values: string[]) => ({ name, values });

describe('mapMetaLeadFields', () => {
  it("maps Meta's standard prefill keys", () => {
    const result = mapMetaLeadFields([
      f('full_name', 'Priya Sharma'),
      f('phone_number', '+919876543210'),
      f('email', 'priya@example.com'),
    ]);
    expect(result).toEqual({
      name: 'Priya Sharma',
      phone: '+919876543210',
      email: 'priya@example.com',
      extras: [],
    });
  });

  it('joins first_name + last_name when there is no full_name', () => {
    const result = mapMetaLeadFields([
      f('first_name', 'Priya'),
      f('last_name', 'Sharma'),
      f('phone_number', '+919876543210'),
    ]);
    expect(result.name).toBe('Priya Sharma');
  });

  it('collapses key punctuation and casing', () => {
    // Meta hands back whatever the question text produced.
    const result = mapMetaLeadFields([
      f('Phone Number?', '+919876543210'),
      f('Email Address', 'priya@example.com'),
    ]);
    expect(result.phone).toBe('+919876543210');
    expect(result.email).toBe('priya@example.com');
  });

  it('recognizes a WhatsApp-titled phone question', () => {
    const result = mapMetaLeadFields([f('whatsapp_number', '9876543210')]);
    expect(result.phone).toBe('9876543210');
  });

  it('falls back to SHAPE when the gym renamed the question', () => {
    // The whole point of tier 3: a gym asking in Hindi still gets its
    // leads. Neither key matches an alias; the values give them away.
    const result = mapMetaLeadFields([
      f('aap_ka_naam', 'Priya Sharma'),
      f('sampark_number', '9876543210'),
      f('aap_ka_email', 'priya@example.com'),
    ]);
    expect(result.phone).toBe('9876543210');
    expect(result.email).toBe('priya@example.com');
    // The name has no distinguishing shape, so it stays an extra rather
    // than being guessed at — better a missing name than a wrong one.
    expect(result.name).toBeNull();
    expect(result.extras).toEqual([
      { label: 'Aap ka naam', value: 'Priya Sharma' },
    ]);
  });

  it('does not mistake a long free-text answer for a phone number', () => {
    const result = mapMetaLeadFields([
      f('full_name', 'Priya'),
      f(
        'tell_us_about_your_goals',
        'I want to lose about 10 kg before my wedding in 2027 and build stamina'
      ),
    ]);
    expect(result.phone).toBeNull();
    expect(result.extras).toHaveLength(1);
  });

  it('preserves unmapped answers in order, humanised', () => {
    const result = mapMetaLeadFields([
      f('full_name', 'Priya'),
      f('phone_number', '+919876543210'),
      f('what_is_your_goal', 'Weight loss'),
      f('preferred_timing', 'Morning'),
    ]);
    expect(result.extras).toEqual([
      { label: 'What is your goal', value: 'Weight loss' },
      { label: 'Preferred timing', value: 'Morning' },
    ]);
  });

  it('ignores empty values and empty field_data', () => {
    expect(mapMetaLeadFields([])).toEqual({
      name: null,
      phone: null,
      email: null,
      extras: [],
    });
    const result = mapMetaLeadFields([f('phone_number'), f('email', '')]);
    expect(result.phone).toBeNull();
    expect(result.email).toBeNull();
  });

  it('returns a null phone for an email-only lead form', () => {
    // The caller must SKIP these: contacts.phone is NOT NULL and a
    // phone-less lead is unreachable on the WhatsApp wedge anyway.
    const result = mapMetaLeadFields([
      f('full_name', 'Priya Sharma'),
      f('email', 'priya@example.com'),
    ]);
    expect(result.phone).toBeNull();
    expect(result.email).toBe('priya@example.com');
  });
});
