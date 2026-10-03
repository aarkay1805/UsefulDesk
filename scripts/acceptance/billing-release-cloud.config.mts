import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      'server-only': fileURLToPath(
        new URL('../../src/test/server-only.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/acceptance/billing-release-cloud.acceptance.mjs'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { ENCRYPTION_KEY: '0'.repeat(64), META_APP_SECRET: 'synthetic' },
  },
});
