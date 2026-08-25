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

  it('documents the exact invoice document provider contract', () => {
    const runbook = read('docs/invoice-documents.md');

    expect(runbook).toContain('ten exact template contracts');
    expect(runbook).toContain('`invoice_document`');
    expect(runbook).toContain('`gym_invoice_document`');
    expect(runbook).toContain('Utility');
    expect(runbook).toContain('`en_US`');
    expect(runbook).toContain('POSITIONAL');
    expect(runbook).toContain('document header');
    expect(runbook).toMatch(
      /Customer name[^\n]*Invoice number[^\n]*Invoice total[^\n]*Business name/
    );
    expect(runbook).toContain('`whatsapp_account_updates`');
  });

  it('keeps provider readiness separate from shipped application behavior', () => {
    const runbook = read('docs/invoice-documents.md');

    expect(runbook).toMatch(
      /not present, Approved, or synced at the provider/i
    );
    expect(runbook).toContain(
      'Approve and sync gym_invoice_document in en_US before sending.'
    );
    expect(runbook).toMatch(/No Meta submission or customer send occurred/i);
    expect(runbook).toMatch(
      /separate, explicit authorization[^\n]*Meta submission/i
    );
    expect(runbook).toMatch(/harmless sample/i);
    expect(runbook).toMatch(/never send a real customer message/i);
  });

  it('documents invoice authorization, private storage, and immutable reuse', () => {
    const runbook = read('docs/invoice-documents.md');

    expect(runbook).toMatch(/admin and owner[^\n]*Invoice details/i);
    expect(runbook).toMatch(/viewer[^\n]*download/i);
    expect(runbook).toMatch(/agent[^\n]*share/i);
    expect(runbook).toContain('private `invoice-documents` bucket');
    expect(runbook).toContain(
      '`account-<account_id>/<invoice_id>/invoice-<invoice_number>.pdf`'
    );
    expect(runbook).toContain('SHA-256');
    expect(runbook).toMatch(/same stored bytes[^\n]*never regenerate/i);
    expect(runbook).toMatch(/signed URL[^\n]*five minutes/i);
    expect(runbook).toMatch(/does not persist the signed URL/i);
  });

  it('documents non-tax scope and immutable artifact recovery', () => {
    const runbook = read('docs/invoice-documents.md');

    expect(runbook).toContain(
      'Non-tax invoice - GST and tax calculations are not included.'
    );
    expect(runbook).toMatch(
      /GST-ready and statutory documents remain deferred/i
    );
    expect(runbook).toMatch(/ready metadata[^\n]*object is missing/i);
    expect(runbook).toMatch(/fail loudly[^\n]*do not regenerate/i);
    expect(runbook).toMatch(/later payments[^\n]*do not change/i);
  });

  it('records shipped invoice documents without overstating provider delivery', () => {
    const changelog = read('docs/changelog.md');
    const roadmap = read('PRDs/roadmap.md');

    for (const current of [changelog, roadmap]) {
      expect(current).toContain('immutable non-tax PDF');
      expect(current).toContain('ten exact Meta payloads');
      expect(current).toMatch(/GST-ready[^\n]*deferred/i);
      expect(current).toMatch(/gym_invoice_document[^\n]*not[^\n]*Approved/i);
    }

    for (const migration of [
      '20260824235500_immutable_invoice_identity.sql',
      '20260824235600_immutable_invoice_documents.sql',
      '20260825093309_fix_invoice_profile_save_guard_conflict.sql',
      '20260825093752_index_invoice_document_foreign_keys.sql',
    ]) {
      expect(changelog).toContain(migration);
    }

    const currentStatusDocs = [
      read('docs/invoice-documents.md'),
      read('docs/gym-domain.md'),
      read('PRDs/finance_master_section.md'),
      roadmap,
    ].join('\n');
    expect(currentStatusDocs).not.toMatch(/nine[- ]template|nine exact Meta/i);
    expect(currentStatusDocs).toMatch(/ten[- ]template|ten exact Meta/i);

    expect(
      read(
        'docs/superpowers/specs/2026-08-24-immutable-invoice-documents-design.md'
      )
    ).toContain('Status: implemented and verified');
  });
});
