import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('gym WhatsApp template documentation contract', () => {
  it('keeps current renewal operations on the exact Marketing contracts', () => {
    const runbook = read('docs/renewal-reminders.md');
    const current = runbook.split('## Historical provider evidence')[0];

    expect(current).toContain('`gym_membership_renewal`');
    expect(current).toContain('`gym_service_renewal`');
    expect(current).toMatch(/membership renewal[^\n]*Marketing/i);
    expect(current).toMatch(/service renewal[^\n]*Marketing/i);
    expect(current).toContain('`whatsapp_marketing`');
    expect(current).not.toContain('gym_membership_expiry_notice');
    expect(current).not.toContain('gym_renewal_reminder');
    expect(current).not.toContain('gym_service_renewal_reminder');
  });

  it('documents exact Utility payment contracts and scoped opt-in', () => {
    const installments = read('docs/payment-installments.md');
    const paymentLinks = read(
      'docs/razorpay-oauth-payment-links-and-refunds.md'
    );

    expect(installments).toContain('`gym_installment_reminder`');
    expect(installments).toContain('Utility');
    expect(installments).toContain('`whatsapp_account_updates`');
    expect(paymentLinks).toContain('`gym_payment_link`');
    expect(paymentLinks).toContain('`whatsapp_account_updates`');
  });

  it('distinguishes provider review, acceptance, and delivery truth', () => {
    const runbook = read('docs/renewal-reminders.md');

    for (const word of [
      'submitted',
      'Pending',
      'Approved',
      'accepted',
      'delivered',
    ]) {
      expect(runbook).toContain(word);
    }
    expect(runbook).toMatch(/approval[^\n]*not guaranteed/i);
    expect(runbook).toMatch(/delivery[^\n]*not guaranteed/i);
  });

  it('records the shipped library in product history', () => {
    expect(read('docs/changelog.md')).toContain(
      'Gym WhatsApp template contract library'
    );
    expect(read('PRDs/roadmap.md')).toContain(
      'Gym WhatsApp template contract library'
    );
  });
});
