import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/components/layout/branch-switcher.tsx'),
  'utf8'
);

describe('BranchSwitcher menu structure', () => {
  it('keeps the Base UI group label inside a menu group', () => {
    expect(source).toMatch(
      /<DropdownMenuGroup>\s*<DropdownMenuLabel>Branches<\/DropdownMenuLabel>[\s\S]*?<\/DropdownMenuGroup>/
    );
  });
});
