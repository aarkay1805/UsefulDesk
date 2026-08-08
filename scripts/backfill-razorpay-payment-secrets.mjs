#!/usr/bin/env node

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const apply = process.argv.includes('--apply');
const inventoryPath = argument('--inventory');
const deploymentMode = process.env.RAZORPAY_MODE;
const encryptionKey = process.env.ENCRYPTION_KEY ?? '';

if (!inventoryPath) {
  throw new Error('Pass --inventory <reviewed-account-mode.json>');
}
if (deploymentMode !== 'test' && deploymentMode !== 'live') {
  throw new Error('RAZORPAY_MODE must be test or live');
}
if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
  throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
}
if (apply && process.env.RAZORPAY_SECRET_BACKFILL_CONFIRM !== 'reviewed') {
  throw new Error(
    'Set RAZORPAY_SECRET_BACKFILL_CONFIRM=reviewed only after reviewing the inventory and target project'
  );
}

const rawInventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const entries = Array.isArray(rawInventory)
  ? rawInventory
  : Object.entries(rawInventory).map(([account_id, provider_mode]) => ({
      account_id,
      provider_mode,
    }));
const inventory = new Map();
for (const entry of entries) {
  if (
    !entry ||
    typeof entry.account_id !== 'string' ||
    (entry.provider_mode !== 'test' && entry.provider_mode !== 'live')
  ) {
    throw new Error(
      'Inventory rows require account_id and test|live provider_mode'
    );
  }
  if (entry.provider_mode !== deploymentMode) {
    throw new Error(
      'Inventory contains an account for a different deployment mode'
    );
  }
  if (inventory.has(entry.account_id)) {
    throw new Error('Inventory contains a duplicate account_id');
  }
  inventory.set(entry.account_id, entry.provider_mode);
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(encryptionKey, 'hex'),
    iv
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${cipher
    .getAuthTag()
    .toString('hex')}`;
}

function verifyVersionOne(value) {
  const [ivHex, ciphertextHex, tagHex, extra] = value.split(':');
  if (extra !== undefined) throw new Error('unrecognised ciphertext format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('invalid AES-GCM metadata');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(encryptionKey, 'hex'),
    iv
  );
  decipher.setAuthTag(tag);
  decipher.update(ciphertextHex, 'hex', 'utf8');
  decipher.final('utf8');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase URL and service-role key are required');
}
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rows, error } = await admin
  .from('account_payment_credentials')
  .select(
    'account_id, gateway, authentication_mode, provider_mode, secret_storage_version, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret'
  )
  .eq('gateway', 'razorpay');
if (error) throw new Error(`load credentials: ${error.message}`);

const totals = {
  configured: 0,
  reviewed: 0,
  versionZero: 0,
  missingInventory: 0,
  missingSecrets: 0,
  modeMismatch: 0,
  decryptFailure: 0,
  changed: 0,
  versionZeroChanged: 0,
};

for (const row of rows ?? []) {
  const configured = Boolean(
    row.razorpay_key_id ||
    row.razorpay_key_secret ||
    row.razorpay_webhook_secret
  );
  if (!configured) continue;
  totals.configured += 1;
  const reviewedMode = inventory.get(row.account_id);
  if (!reviewedMode) {
    totals.missingInventory += 1;
    continue;
  }
  totals.reviewed += 1;
  if (row.provider_mode && row.provider_mode !== reviewedMode) {
    totals.modeMismatch += 1;
    continue;
  }
  if (!row.razorpay_key_secret || !row.razorpay_webhook_secret) {
    totals.missingSecrets += 1;
  }

  const patch = {
    authentication_mode: 'manual',
    provider_mode: reviewedMode,
    connection_status:
      row.razorpay_key_id &&
      row.razorpay_key_secret &&
      row.razorpay_webhook_secret
        ? 'ready'
        : 'disconnected',
  };
  if (row.secret_storage_version === 0) {
    totals.versionZero += 1;
    patch.secret_storage_version = 1;
    if (row.razorpay_key_secret) {
      patch.razorpay_key_secret = encrypt(row.razorpay_key_secret);
    }
    if (row.razorpay_webhook_secret) {
      patch.razorpay_webhook_secret = encrypt(row.razorpay_webhook_secret);
    }
  } else if (row.secret_storage_version === 1) {
    try {
      if (row.razorpay_key_secret) verifyVersionOne(row.razorpay_key_secret);
      if (row.razorpay_webhook_secret) {
        verifyVersionOne(row.razorpay_webhook_secret);
      }
    } catch {
      totals.decryptFailure += 1;
      continue;
    }
  } else {
    totals.decryptFailure += 1;
    continue;
  }

  if (apply) {
    let update = admin
      .from('account_payment_credentials')
      .update(patch)
      .eq('account_id', row.account_id)
      .eq('gateway', 'razorpay');
    if (row.secret_storage_version === 0) {
      update = update.eq('secret_storage_version', 0);
    }
    const { data: changed, error: updateError } =
      await update.select('account_id');
    if (updateError)
      throw new Error(`update credentials: ${updateError.message}`);
    if (changed?.length) {
      totals.changed += 1;
      if (row.secret_storage_version === 0) totals.versionZeroChanged += 1;
    }
  }
}

console.log(
  JSON.stringify(
    {
      mode: deploymentMode,
      action: apply ? 'applied' : 'dry-run',
      ...totals,
    },
    null,
    2
  )
);

if (
  totals.missingInventory ||
  totals.missingSecrets ||
  totals.modeMismatch ||
  totals.decryptFailure ||
  (apply && totals.versionZero !== totals.versionZeroChanged)
) {
  process.exitCode = 1;
}
