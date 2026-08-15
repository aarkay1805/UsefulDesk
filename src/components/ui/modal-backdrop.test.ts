import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MODAL_BACKDROP_CLASS,
  MODAL_PARENT_WITH_CHILD_CLASS,
} from './modal-backdrop';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('modal backdrop contract', () => {
  it('keeps one visible blur recipe for dialogs and sheets', () => {
    expect(MODAL_BACKDROP_CLASS.split(' ')).toEqual(
      expect.arrayContaining([
        'fixed',
        'inset-0',
        'z-50',
        'bg-background/40',
        'backdrop-blur-sm',
      ])
    );

    const dialog = source('src/components/ui/dialog.tsx');
    const sheet = source('src/components/ui/sheet.tsx');
    const popover = source('src/components/ui/popover.tsx');

    expect(dialog).toContain('MODAL_BACKDROP_CLASS');
    expect(sheet).toContain('MODAL_BACKDROP_CLASS');
    expect(popover).not.toContain('MODAL_BACKDROP_CLASS');
  });

  it('blurs the parent modal surface when Base UI suppresses a child backdrop', () => {
    expect(MODAL_PARENT_WITH_CHILD_CLASS).toContain(
      'data-[nested-dialog-open]:blur-sm'
    );

    const dialog = source('src/components/ui/dialog.tsx');
    const sheet = source('src/components/ui/sheet.tsx');

    expect(dialog).toContain('MODAL_PARENT_WITH_CHILD_CLASS');
    expect(sheet).toContain('MODAL_PARENT_WITH_CHILD_CLASS');
  });
});
