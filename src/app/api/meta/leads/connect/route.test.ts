import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');

describe('Meta Lead Ads connection boundary', () => {
  it('guards both mutations against cross-origin requests', () => {
    expect(source.match(/requireSameOriginRequest\(request\)/g)).toHaveLength(
      2
    );
  });

  it('verifies the Meta user and Page health before storing credentials', () => {
    const userAt = source.indexOf('await getMetaUser');
    const healthAt = source.indexOf('await diagnoseAndRepairMetaPage');
    const writeAt = source.indexOf("from('meta_page_config')", healthAt);
    expect(userAt).toBeGreaterThan(0);
    expect(healthAt).toBeGreaterThan(userAt);
    expect(writeAt).toBeGreaterThan(healthAt);
    expect(source).toContain('connected_meta_user_id');
    expect(source).toContain('credential_generation');
  });

  it('compensates a newly installed provider subscription when storage fails', () => {
    const writeFailureAt = source.indexOf('if (writeFailed)');
    expect(writeFailureAt).toBeGreaterThan(0);
    expect(
      source.indexOf('await unsubscribePageFromLeadgen', writeFailureAt)
    ).toBeGreaterThan(writeFailureAt);
  });
});
