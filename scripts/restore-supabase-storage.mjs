#!/usr/bin/env node

import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { restoreStorageBackup } from './export-supabase-storage.mjs';

async function main() {
  const inputDirectory = process.argv[2];
  const supabaseUrl = process.env.RESTORE_SUPABASE_URL;
  const serviceRoleKey = process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY;

  if (!inputDirectory || !supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Usage: RESTORE_SUPABASE_URL=... RESTORE_SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-supabase-storage.mjs <input-directory>'
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await restoreStorageBackup({
    inputDirectory: resolve(inputDirectory),
    supabase,
  });
  console.info(
    `Restored and verified ${result.objects} Storage objects (${result.totalBytes} bytes).`
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Storage restore failed'
  );
  process.exitCode = 1;
});
