import { describe, expect, it } from 'vitest';
import { GYM_NAME_ERROR, normalizeGymName } from './gym-name';

describe('normalizeGymName', () => {
  it('trims a valid gym name', () => {
    expect(normalizeGymName('  Iron House  ')).toBe('Iron House');
  });

  it('rejects non-strings, whitespace, and names over 80 Unicode code points', () => {
    expect(normalizeGymName(undefined)).toBeNull();
    expect(normalizeGymName('   ')).toBeNull();
    expect(normalizeGymName('🏋️'.repeat(41))).toBeNull();
    expect(GYM_NAME_ERROR).toContain('80');
  });

  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect(normalizeGymName('😀'.repeat(80))).toBe('😀'.repeat(80));
    expect(normalizeGymName('😀'.repeat(81))).toBeNull();
  });
});
