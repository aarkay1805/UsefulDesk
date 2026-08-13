import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('authored automation and flow UI gates', () => {
  it('uses authored-content predicates for automation list mutations', () => {
    const page = source('src/app/(dashboard)/automations/page.tsx');

    expect(page).toContain('canEditAuthoredContent(');
    expect(page).toContain('canDeleteAuthoredContent(');
    expect(page).toMatch(/<Switch[\s\S]*?disabled=\{!canEdit\}/);
    expect(page).toMatch(
      /<DropdownMenuItem[\s\S]*?onClick=\{onEdit\}[\s\S]*?disabled=\{!canEdit\}/
    );
    expect(page).toMatch(
      /variant="destructive"[\s\S]*?onClick=\{onDelete\}[\s\S]*?disabled=\{!canDelete\}/
    );
  });

  it('uses authored-content predicates for flow list and direct editor access', () => {
    const list = source('src/app/(dashboard)/flows/page.tsx');
    const editor = source('src/app/(dashboard)/flows/[id]/page.tsx');

    expect(list).toContain('canEditAuthoredContent(');
    expect(list).toContain('canDeleteAuthoredContent(');
    expect(list).toMatch(/onClick=\{onEdit\}[\s\S]*?disabled=\{!canEdit\}/);
    expect(list).toMatch(/onClick=\{onDelete\}[\s\S]*?disabled=\{!canDelete\}/);
    expect(editor).toContain('canEditAuthoredContent(');
    expect(editor).toContain('Only the flow author can edit or activate it.');
  });
});
