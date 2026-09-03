import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260903120000_mobile_push_notifications.sql'
  ),
  'utf8'
);

function fn(name: string) {
  return sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$;`
    )
  )?.[0];
}

describe('push lease and settlement contract', () => {
  it('claims bounded due work with skip-locked leases and stale recovery', () => {
    const claim = fn('claim_push_deliveries');

    expect(claim).toBeDefined();
    expect(claim).toMatch(/LEAST\(GREATEST\(p_limit, 1\), 100\)/);
    expect(claim).toMatch(/FOR UPDATE OF delivery SKIP LOCKED/);
    expect(claim).toMatch(/delivery\.lease_expires_at <= clock_timestamp\(\)/);
    expect(claim).toMatch(/lease_owner = p_worker_id/);
    expect(claim).toMatch(/attempt_count = delivery\.attempt_count \+ 1/);
  });

  it('revalidates assignment, membership, branch, and installation eligibility', () => {
    const claim = fn('claim_push_deliveries');

    expect(claim).toMatch(/installation\.revoked_at IS NULL/);
    expect(claim).toMatch(/account\.branch_status = 'active'/);
    expect(claim).toMatch(/membership\.account_id = delivery\.account_id/);
    expect(claim).toMatch(
      /conversation\.assigned_agent_id = delivery\.recipient_user_id/
    );
    expect(claim).toMatch(
      /conversation\.assigned_agent_id IS NULL[\s\S]*?membership\.role IN \('owner', 'admin', 'agent'\)/
    );
    expect(claim).toMatch(/state = 'cancelled'/);
  });

  it('claims ticket receipts separately without treating tickets as delivery', () => {
    const receipts = fn('claim_push_receipts');

    expect(receipts).toBeDefined();
    expect(receipts).toMatch(/delivery\.state = 'ticketed'/);
    expect(receipts).toMatch(/delivery\.expo_ticket_id IS NOT NULL/);
    expect(receipts).toMatch(/FOR UPDATE OF delivery SKIP LOCKED/);
    expect(receipts).toMatch(/lease_owner = p_worker_id/);
  });

  it('settles only the current lease owner and retires permanent tokens', () => {
    const settle = fn('settle_push_delivery');

    expect(settle).toBeDefined();
    expect(settle).toMatch(/delivery\.lease_owner = p_worker_id/);
    expect(settle).toMatch(
      /p_outcome NOT IN \([\s\S]*?'ticketed'[\s\S]*?'delivered'[\s\S]*?'retry'[\s\S]*?'failed'[\s\S]*?'cancelled'[\s\S]*?\)/
    );
    expect(settle).toMatch(/LEFT\(p_error_code, 120\)/);
    expect(settle).toMatch(/lease_owner = NULL/);
    expect(settle).toMatch(/lease_expires_at = NULL/);
    expect(settle).toMatch(/p_retire_installation/);
    expect(settle).toMatch(
      /UPDATE public\.push_installations[\s\S]*?revoked_at = COALESCE\(revoked_at, clock_timestamp\(\)\)/
    );
    expect(settle).toMatch(
      /UPDATE public\.push_deliveries[\s\S]*?state = 'failed'[\s\S]*?installation_id = v_installation_id/
    );
  });
});
