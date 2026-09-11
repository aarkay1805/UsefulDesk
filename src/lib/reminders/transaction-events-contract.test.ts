import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('transaction reminder lifecycle migration contract', () => {
  const lifecycle = read('supabase/migrations/20260911010200_autopay_recovery_and_payment_confirmations.sql');
  const settlement = read('supabase/migrations/20260911010400_supersede_autopay_recovery_on_manual_settlement.sql');
  const eventKind = read('supabase/migrations/20260911010500_harden_autopay_recovery_event_kind.sql');
  const binding = read('supabase/migrations/20260911010600_bind_confirmations_and_autopay_cycles.sql');
  const renewalIdentity = read('supabase/migrations/20260911010700_confirm_renewal_operation_identity.sql');
  const insertBoundary = read('supabase/migrations/20260911010800_confirm_new_ledger_rows_after_activation.sql');
  const worker = read('src/lib/reminders/transaction-events.ts');

  it('keeps both factual schedules disabled, activation-bounded, and payment-keyed', () => {
    expect(lifecycle).toContain('payment_confirmations_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(lifecycle).toContain('autopay_recovery_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(lifecycle).toContain("NEW.created_at < v_settings.payment_confirmations_activated_at THEN RETURN NEW");
    expect(lifecycle).toContain("'payment_confirmation:' || NEW.id::TEXT || ':' || v_settings.payment_confirmations_generation::TEXT");
    expect(lifecycle).toContain('AFTER INSERT ON public.payments');
  });

  it('accepts recovery only from its matching, verified canonical provider fact', () => {
    expect(eventKind).toContain("p_event_kind = 'retry_pending' AND v_event.type <> 'subscription.pending'");
    expect(eventKind).toContain("p_event_kind = 'terminal' AND v_event.type <> 'subscription.halted'");
    expect(eventKind).toContain("v_event.payload #>> '{payload,subscription,entity,id}' IS DISTINCT FROM v_mandate.gateway_subscription_id");
    expect(eventKind).toContain('ON CONFLICT(account_id,canonical_webhook_event_id)');
    expect(eventKind).toContain('ON CONFLICT(account_id,business_key) DO NOTHING');
  });

  it('leaves partial debt open while newer full settlement supersedes stale recovery', () => {
    expect(settlement).toContain('balance.collectible_balance <= 0');
    expect(settlement).toContain('observed_at <= NEW.created_at');
    expect(settlement).toContain('NEW.mandate_id IS NOT NULL');
    expect(settlement).not.toContain('UPDATE public.payments');
  });

  it('requires the matching renewal operation and signed provider cycle before making a renewal or terminal-debt claim', () => {
    expect(binding).toContain("operation.operation = 'renew'");
    expect(binding).toContain('operation.idempotency_key = NEW.idempotency_key');
    expect(binding).toContain("'{payload,subscription,entity,current_end}'");
    expect(binding).toContain('IF v_cycle_end IS NOT NULL THEN');
    expect(binding).not.toContain('period.period_end=member.end_date');
    expect(renewalIdentity).toContain("operation.operation = 'renew'");
    expect(renewalIdentity).not.toContain("NEW.payment_purpose = 'renewal'");
    expect(insertBoundary).toContain('AFTER INSERT trigger');
    expect(insertBoundary).not.toContain('NEW.created_at < v_settings.payment_confirmations_activated_at');
  });

  it('does not consume chasing capacity and rechecks facts at the provider boundary', () => {
    expect(worker).toContain('reserveDailyClaim');
    expect(worker).toContain("contract === 'autopay_recovery_terminal'");
    expect(worker).toContain('invoice_collection_commitments');
    expect(worker).toContain('beforeSend: async () =>');
    expect(worker).toContain('payment_confirmation_state_changed');
    expect(worker).toContain('autopay_terminal_state_changed');
    expect(worker).toContain('await markProviderAttempt()');
  });
});
