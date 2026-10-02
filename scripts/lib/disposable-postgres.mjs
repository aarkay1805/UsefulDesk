/** Local subscription fixtures only; never resolves .env or cloud connections. */
import { execFileSync } from 'node:child_process';

const CONTAINERS = {
  full: /^supabase_db_usefuldesk-subscription-full-[a-z0-9]+$/,
  test: /^supabase_db_usefuldesk-subscription-test\.[A-Za-z0-9]+$/,
};

export function createDisposablePostgres(
  container,
  {
    kind = 'full',
    errorMessage = 'Pass an explicit disposable subscription-full database container',
    maxBuffer = kind === 'full' ? 8 * 1024 * 1024 : 1024 * 1024,
  } = {}
) {
  if (!Object.hasOwn(CONTAINERS, kind))
    throw new Error('Unknown disposable subscription database kind');
  if (!CONTAINERS[kind].test(container ?? '')) throw new Error(errorMessage);

  const args = (database = 'postgres', role = 'postgres') => [
    'exec',
    '-i',
    container,
    'psql',
    ...(kind === 'full' ? ['-X'] : []),
    '-U',
    role,
    '-d',
    database,
    ...(kind === 'full'
      ? ['-Atq', '-v', 'ON_ERROR_STOP=1']
      : ['-v', 'ON_ERROR_STOP=1', '-Atq']),
  ];
  const sql = (input, { database = 'postgres', role = 'postgres' } = {}) =>
    execFileSync('docker', args(database, role), {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer,
    });

  return { args, sql };
}
