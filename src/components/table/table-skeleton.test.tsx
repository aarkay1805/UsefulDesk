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
});
