import { describe, expect, it } from 'vitest';

import {
  BRANCH_SETUP_WARNING_CODES,
  BRANCH_SETUP_WARNING_REGISTRY,
  hasBranchSetupPrerequisite,
  isBranchSetupComplete,
  normalizeBranchSetupPacks,
  parseBranchSetupPacks,
} from './setup';

describe('branch setup contract helpers', () => {
  it('deduplicates packs in canonical order and locks the lead setup dependency', () => {
    expect(
      normalizeBranchSetupPacks(['flows', 'membership_catalog', 'flows'])
    ).toEqual(['membership_catalog', 'lead_setup', 'flows']);
    expect(normalizeBranchSetupPacks(['automations'])).toEqual([
      'lead_setup',
      'automations',
    ]);
  });

  it('rejects unknown packs instead of silently dropping them', () => {
    expect(parseBranchSetupPacks(['lead_setup', 'unknown'])).toEqual({
      ok: false,
      invalid: 'unknown',
    });
  });

  it('keeps a display message registered for every stable SQL warning code', () => {
    expect(Object.keys(BRANCH_SETUP_WARNING_REGISTRY).sort()).toEqual(
      [...BRANCH_SETUP_WARNING_CODES].sort()
    );
  });

  it('requires one active plan joined to one active pricing option', () => {
    expect(
      hasBranchSetupPrerequisite([
        { is_active: false, pricing_options: [{ is_active: true }] },
        { is_active: true, pricing_options: [{ is_active: false }] },
      ])
    ).toBe(false);
    expect(
      hasBranchSetupPrerequisite([
        { is_active: true, pricing_options: [{ is_active: true }] },
      ])
    ).toBe(true);
  });

  it('derives completion only from active, ready, reviewed, still-valid setup', () => {
    const complete = {
      branchStatus: 'active' as const,
      readinessState: 'ready' as const,
      setupReviewedAt: '2026-08-13T10:00:00.000Z',
      hasPrerequisite: true,
    };
    expect(isBranchSetupComplete(complete)).toBe(true);
    expect(isBranchSetupComplete({ ...complete, hasPrerequisite: false })).toBe(
      false
    );
    expect(
      isBranchSetupComplete({ ...complete, readinessState: 'attention' })
    ).toBe(false);
  });
});
