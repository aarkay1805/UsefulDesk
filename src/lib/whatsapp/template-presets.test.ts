import { describe, expect, it } from 'vitest';

import { RENEWAL_TEMPLATE_NAME } from '@/lib/memberships/renewal-reminders';
import { extractVariableIndices } from './template-validators';
import { TEMPLATE_PRESETS } from './template-presets';

describe('renewal reminder preset', () => {
  it('stays a transactional account update with the pinned send contract', () => {
    const preset = TEMPLATE_PRESETS.find(
      (candidate) => candidate.id === 'renewal_reminder'
    );

    expect(preset).toBeDefined();
    expect(preset?.pinned).toBe(true);
    expect(preset?.fields.name).toBe(RENEWAL_TEMPLATE_NAME);
    expect(preset?.fields.category).toBe('Utility');
    expect(extractVariableIndices(preset?.fields.body_text ?? '')).toEqual([
      1, 2, 3, 4,
    ]);

    const body = preset?.fields.body_text ?? '';
    expect(body).toMatch(/account update/i);
    expect(body).toMatch(/existing .*membership/i);
    expect(body).not.toMatch(
      /complet\w* renewal|renew now|pay now|discount|special offer/i
    );
  });
});
