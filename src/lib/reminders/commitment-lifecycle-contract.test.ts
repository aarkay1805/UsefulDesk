import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('invoice commitment lifecycle migration contract', () => {
  const migration = read('supabase/migrations/20260911010000_invoice_commitment_lifecycle.sql');

  it('keeps promises revisioned, invoice-bounded, and author-controlled', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.invoice_collection_commitments');
    expect(migration).toContain("kind IN ('promise_to_pay', 'verification_hold', 'dispute_hold')");
    expect(migration).toContain('Promise amount exceeds current collectible balance');
    expect(migration).toContain('Assignee is not a member of this branch');
    expect(migration).toContain('Only the author may edit this commitment');
    expect(migration).toContain("event IN ('created', 'revised', 'fulfilled', 'broken', 'resolved', 'cancelled')");
  });

  it('uses allocation snapshots and one-open-follow-up reconciliation rather than invoice settlement or reply text', () => {
    expect(migration).toContain('payment_allocation_snapshot');
    expect(migration).toContain('v_paid >= v_commitment.amount');
    expect(migration).toContain("FROM public.follow_ups WHERE account_id=v_commitment.account_id AND contact_id=v_commitment.contact_id AND status='open'");
    expect(migration).not.toContain('sender_type = \'customer\'');
  });

  it('records a provider-accepted payment-link send and keeps expiry as staff work', () => {
    expect(migration).toContain('record_payment_link_whatsapp_send');
    expect(migration).toContain('last_whatsapp_message_id=p_whatsapp_message_id, last_sent_at=NOW()');
    expect(migration).toContain('escalate_expired_payment_link');
    expect(migration).toContain('Generate a replacement through the invoice payment-link action');
  });

  it('extends rather than replaces the existing activation guards', () => {
    expect(migration).toContain('Membership post-expiry activation fields are system managed');
    expect(migration).toContain('Service post-expiry activation fields are system managed');
    expect(migration).toContain('Invoice collection activation fields are system managed');
    expect(migration).toContain('Promise-to-pay activation fields are system managed');
  });
});
