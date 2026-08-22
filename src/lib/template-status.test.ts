import { describe, expect, it } from 'vitest';

import { resolveTemplateStatusDisplay } from './template-status';

describe('resolveTemplateStatusDisplay', () => {
  it('never presents a provider-missing row as Approved', () => {
    expect(
      resolveTemplateStatusDisplay('APPROVED', '2026-08-22T00:00:00.000Z').label
    ).toBe('Not on Meta');
  });

  it('uses the provider status when the row is present', () => {
    expect(resolveTemplateStatusDisplay('APPROVED', null).label).toBe(
      'Approved'
    );
  });
});
