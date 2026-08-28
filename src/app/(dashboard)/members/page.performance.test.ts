import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('members initial bundle', () => {
  it('defers inactive views and unopened dialogs', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain("import dynamic from 'next/dynamic'");
    expect(source).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(/);
    expect(source).toContain('{formOpen ? (');
    expect(source).toContain('{importOpen ? (');
    expect(source).toContain('{detailOpen ? (');
  });

  it('derives the active listing from router search params before children mount', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain(
      "import { useSearchParams } from 'next/navigation'"
    );
    expect(source).toContain("const requestedView = searchParams.get('view')");
    expect(source).not.toContain("useState<View>('renewals')");
    expect(source).not.toContain('setView(requested)');
  });
});
