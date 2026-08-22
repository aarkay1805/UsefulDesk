import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');

describe('manual Meta Page health boundary', () => {
  it('requires same-origin settings access and exact tenant config lookup', () => {
    expect(source).toContain('requireSameOriginRequest(request)');
    expect(source).toContain('await requireSettingsAccess()');
    expect(source).toContain(".eq('id', configId)");
    expect(source).toContain(".eq('account_id', accountId)");
  });

  it('force-claims the exact config and returns only safe health fields', () => {
    expect(source).toContain("'claim_meta_page_health_batch'");
    expect(source).toContain('p_force_config_id: configId');
    expect(source).toContain('diagnoseClaimedMetaPage');
    expect(source).toContain('retainMetaPageHealthResult');
    expect(source).not.toMatch(/NextResponse\.json\([^)]*page_id/);
    expect(source).not.toMatch(/NextResponse\.json\([^)]*account_id/);
    expect(source).not.toMatch(/NextResponse\.json\([^)]*page_access_token/);
  });
});
