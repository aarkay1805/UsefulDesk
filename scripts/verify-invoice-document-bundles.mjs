// Run after npm run build. Load the actual invoice handlers with only the
// traced deployment files, without local node_modules, credentials, or sends.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const project = process.cwd();
for (const action of ['document', 'share']) {
  const route = `.next/server/app/api/invoices/[invoiceId]/${action}/route.js`;
  const tracePath = resolve(project, `${route}.nft.json`);
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  const bundle = mkdtempSync(join(tmpdir(), 'usefuldesk-invoice-bundle-'));
  try {
    const files = [
      resolve(project, route),
      ...trace.files.map((file) => resolve(dirname(tracePath), file)),
    ];
    for (const file of files) {
      const destination = join(bundle, relative(project, file));
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(file, destination, { recursive: true, dereference: true });
    }
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
          (async () => {
            const route = require(${JSON.stringify(`./${route}`)});
            await route.routeModule.ensureUserland();
            if (typeof route.routeModule.userland.${action === 'document' ? 'GET' : 'POST'} !== 'function') {
              throw new Error('Invoice handler did not load');
            }
            console.log('Invoice ${action} handler loaded in isolated deployment bundle');
          })().catch((error) => { console.error(error.message); process.exitCode = 1; });
        `,
      ],
      {
        cwd: bundle,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      }
    );
    assert.match(output, /handler loaded in isolated deployment bundle/);
    console.log(output.trim());
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
}
