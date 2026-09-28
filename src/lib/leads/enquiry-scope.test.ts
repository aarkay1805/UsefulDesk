import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  onlyCustomers,
  onlyEnquiries,
  selectForEnquiries,
} from './enquiry-scope';

const SRC = join(process.cwd(), 'src');

function source(path: string): string {
  return readFileSync(join(SRC, path), 'utf8');
}

// Read once while the file loads, like the migration contracts, so a busy
// parallel run cannot time the scan out.
const rawAntiJoins = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .filter((path) => path !== join('lib', 'leads', 'enquiry-scope.ts'))
  .filter((path) =>
    /\.is\(\s*['"](?:memberships|member_services)\b/.test(source(path))
  );

describe('enquiry scope', () => {
  it('embeds both customer relations the anti-join filters on', () => {
    expect(selectForEnquiries('id')).toBe(
      'id, memberships!left(id), member_services!left(id)'
    );
  });

  it('keeps only contacts with neither a membership nor a service purchase', () => {
    const calls: [string, null][] = [];
    const query = {
      is(column: string, value: null) {
        calls.push([column, value]);
        return query;
      },
    };

    expect(onlyEnquiries(query)).toBe(query);
    // The embeds themselves: `memberships.id` would keep every contact.
    expect(calls).toEqual([
      ['memberships', null],
      ['member_services', null],
    ]);
  });

  it('includes membership and service-only customers in the complementary chip', () => {
    const calls: string[] = [];
    const query = {
      or(filter: string) {
        calls.push(filter);
        return query;
      },
    };
    expect(onlyCustomers(query)).toBe(query);
    expect(calls).toEqual([
      'memberships.not.is.null,member_services.not.is.null',
    ]);
  });

  it('is the one place client reads anti-join the customer relations', () => {
    expect(rawAntiJoins).toEqual([]);

    for (const path of [
      'components/leads/lead-accountability-view.tsx',
      'components/inbox/conversation-list.tsx',
      'lib/automations/engine.ts',
    ]) {
      expect(source(path)).toContain('onlyEnquiries(');
    }
  });
});
