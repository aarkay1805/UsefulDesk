import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Table, TableBody } from './table';

describe('Table', () => {
  it('lets a composed surface hand scrolling to an outer viewport without styling the table element', () => {
    const html = renderToStaticMarkup(
      <Table containerClassName="overflow-visible" className="table-fixed">
        <TableBody />
      </Table>
    );

    expect(html).toMatch(
      /data-slot="table-container" class="[^"]*overflow-visible[^"]*"/
    );
    expect(html).not.toMatch(
      /data-slot="table-container" class="[^"]*overflow-x-auto[^"]*"/
    );
    expect(html).toMatch(/data-slot="table" class="[^"]*table-fixed[^"]*"/);
    expect(html).not.toContain('containerClassName=');
    expect(html).not.toContain('containerclassname=');
  });
});
