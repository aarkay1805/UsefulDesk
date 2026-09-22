import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CompleteSignupAccessError } from './complete-signup-access-error';

describe('CompleteSignupAccessError', () => {
  it('uses a document navigation for a retry URL', () => {
    const markup = renderToStaticMarkup(
      <CompleteSignupAccessError
        message="Lookup unavailable"
        retryHref="/complete-signup?branch=branch-1"
      />
    );

    expect(markup).toContain('href="/complete-signup?branch=branch-1"');
    const source = readFileSync(
      __filename.replace(
        'complete-signup-access-error.test.tsx',
        'complete-signup-access-error.tsx'
      ),
      'utf8'
    );
    expect(source).not.toContain("from 'next/link'");
  });
});
