import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TableSkeleton } from './table-skeleton';

describe('TableSkeleton', () => {
  it('keeps table headers visible and exposes one loading status', () => {
    const html = renderToStaticMarkup(
      <TableSkeleton
        label="Loading members"
        rows={3}
        columns={[
          { label: 'Name', variant: 'identity' },
          { label: 'Status', variant: 'badge' },
          { label: 'Actions', variant: 'actions' },
        ]}
      />
    );

    expect(html).toContain('>Name<');
    expect(html).toContain('>Status<');
    expect(html).toContain('>Actions<');
    expect(html).toContain('role="status">Loading members');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
  });

  it('preserves a sticky real header and frozen columns inside a composed scroll viewport', () => {
    const html = renderToStaticMarkup(
      <TableSkeleton
        containerClassName="overflow-visible"
        headerClassName="bg-card sticky top-0 z-10"
        label="Loading members"
        rows={2}
        columns={[
          {
            label: '',
            variant: 'checkbox',
            width: 40,
            headClassName: 'bg-card sticky left-0 z-20',
            cellClassName: 'bg-card-2 sticky left-0 z-10',
          },
          {
            label: 'Name',
            variant: 'identity',
            width: 220,
            headClassName: 'bg-card sticky z-20',
            headStyle: { left: 40 },
            cellClassName: 'bg-card-2 sticky z-10',
            cellStyle: { left: 40 },
          },
        ]}
      />
    );

    expect(html).toMatch(
      /data-slot="table-container" class="[^"]*overflow-visible[^"]*"/
    );
    expect(html).toMatch(
      /data-slot="table-header" class="[^"]*sticky[^"]*top-0[^"]*"/
    );
    expect(html).toMatch(
      /data-slot="table-head" class="[^"]*sticky[^"]*left-0[^"]*"/
    );
    expect(html).toContain('left:40px');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status">Loading members');
  });
});
