import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/components/layout/branch-switcher.tsx'),
  'utf8'
);
const authSource = readFileSync(
  join(process.cwd(), 'src/hooks/use-auth.tsx'),
  'utf8'
);

describe('BranchSwitcher menu structure', () => {
  it('keeps the Base UI group label inside a menu group', () => {
    expect(source).toMatch(
      /<DropdownMenuGroup>\s*<DropdownMenuLabel>Branches<\/DropdownMenuLabel>[\s\S]*?<\/DropdownMenuGroup>/
    );
  });

  it('does not reject a newly created branch from the stale provider snapshot', () => {
    const switchBranchSource = authSource.match(
      /const switchBranch = useCallback\(([\s\S]*?)\n  }, \[\]\);/
    )?.[1];

    expect(switchBranchSource).toContain("supabase.rpc('record_branch_switch'");
    expect(switchBranchSource).not.toMatch(/branches\.find/);
  });
});
