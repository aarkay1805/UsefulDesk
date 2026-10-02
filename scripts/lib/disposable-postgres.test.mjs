import { beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createDisposablePostgres } from './disposable-postgres.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

beforeEach(() => {
  execFileSync.mockReset();
});

it.each([
  undefined,
  '',
  'fwqthstqrkrwtaehefks',
  'https://example.supabase.co',
  'postgresql://localhost/postgres',
  '--context=production',
  'supabase_db_usefuldesk-subscription-full-test; echo unsafe',
  'supabase_db_usefuldesk-subscription-full-test\n',
  'supabase_db_usefuldesk-subscription-test.fixture',
])('rejects non-full targets before any process call: %s', (container) => {
  expect(() => createDisposablePostgres(container)).toThrow();
  expect(execFileSync).not.toHaveBeenCalled();
});

it.each([
  undefined,
  'supabase_db_usefuldesk-subscription-full-fixture',
  'supabase_db_usefuldesk-subscription-test.fixture/other',
  'supabase_db_usefuldesk-subscription-test.fixture --host=cloud',
])('keeps Test targets distinct: %s', (container) => {
  expect(() => createDisposablePostgres(container, { kind: 'test' })).toThrow();
  expect(execFileSync).not.toHaveBeenCalled();
});

it.each(['production', 'toString', '__proto__'])(
  'refuses unsupported target kinds: %s',
  (kind) => {
    expect(() =>
      createDisposablePostgres(
        'supabase_db_usefuldesk-subscription-full-fixture',
        {
          kind,
        }
      )
    ).toThrow('Unknown disposable subscription database kind');
    expect(execFileSync).not.toHaveBeenCalled();
  }
);

it.each([
  ['full', 'supabase_db_usefuldesk-subscription-full-fixture'],
  ['test', 'supabase_db_usefuldesk-subscription-test.fixture'],
])('keeps fail-fast SQL and raw output for %s fixtures', (kind, container) => {
  execFileSync.mockReturnValue('result\n');
  const db = createDisposablePostgres(container, { kind });
  expect(db.sql('SELECT 1;')).toBe('result\n');
  const [program, args, options] = execFileSync.mock.calls[0];
  expect(program).toBe('docker');
  expect(args).toEqual(expect.arrayContaining([container, 'ON_ERROR_STOP=1']));
  expect(options.input).toBe('SELECT 1;');
  expect(args.includes('-X')).toBe(kind === 'full');
});

it('propagates SQL failure rather than reporting successful acceptance', () => {
  const failure = new Error('SQL fixture failed');
  execFileSync.mockImplementation(() => {
    throw failure;
  });
  const db = createDisposablePostgres(
    'supabase_db_usefuldesk-subscription-full-fixture'
  );
  expect(() => db.sql('invalid SQL')).toThrow(failure);
});

it('selects the clone restore role without changing its database target', () => {
  const db = createDisposablePostgres(
    'supabase_db_usefuldesk-subscription-full-fixture'
  );
  const args = db.args('subscription_documents_fixture', 'supabase_admin');
  expect(args[args.indexOf('-U') + 1]).toBe('supabase_admin');
  expect(args[args.indexOf('-d') + 1]).toBe('subscription_documents_fixture');
});
