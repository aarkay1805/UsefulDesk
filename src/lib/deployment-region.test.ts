import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Vercel function region', () => {
  it('runs beside the Singapore Supabase projects', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')
    ) as { regions?: string[] };

    expect(config.regions).toEqual(['sin1']);
  });
});
