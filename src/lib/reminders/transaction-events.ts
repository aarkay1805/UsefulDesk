import { engineSendTemplate } from '@/lib/automations/meta-send';
import { resolveAccountLocale } from '@/lib/locale/config';
import { buildFormatters, todayInTz } from '@/lib/locale/format';
import { isCollectibleInvoice } from './policy';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

import type { LifecycleReminderJob } from './types';

type Admin = ReturnType<typeof import('@/lib/automations/admin-client').supabaseAdmin>;

type Account = {
  owner_user_id: string;
  timezone: string;
  default_currency: string;
  country_code: string;
  locale: string;
  date_order: string;
  time_format: string;
  week_start: number;
  phone_country_code: string;
  measurement_system: string;
};

type Finish = (state: string, options?: { providerMessageId?: string | null; reason?: Record<string, string>; nextAttemptAt?: string | null }) => Promise<void>;
type FindConversation = (accountId: string, userId: string, contactId: string) => Promise<string>;
type ReserveDailyClaim = (sendOn: string) => Promise<'reserved' | 'deferred'>;

type Settings = {
  payment_confirmations_enabled: boolean;
  payment_confirmations_activated_at: string | null;
  payment_confirmations_generation: string | null;
  autopay_recovery_enabled: boolean;
  autopay_recovery_activated_at: string | null;
  autopay_recovery_generation: string | null;
};

export type TransactionEventResult = 'accepted' | 'blocked' | 'skipped' | 'deferred' | 'ambiguous' | 'failed';

function eventSettings(row: Record<string, unknown> | null): Settings {
  return {
    payment_confirmations_enabled: row?.payment_confirmations_enabled === true,
    payment_confirmations_activated_at: typeof row?.payment_confirmations_activated_at === 'string' ? row.payment_confirmations_activated_at : null,
    payment_confirmations_generation: typeof row?.payment_confirmations_generation === 'string' ? row.payment_confirmations_generation : null,
    autopay_recovery_enabled: row?.autopay_recovery_enabled === true,
    autopay_recovery_activated_at: typeof row?.autopay_recovery_activated_at === 'string' ? row.autopay_recovery_activated_at : null,
    autopay_recovery_generation: typeof row?.autopay_recovery_generation === 'string' ? row.autopay_recovery_generation : null,
  };
}

function retryAt(attemptCount: number, now: Date) {
  return new Date(now.getTime() + Math.min(60, 2 ** Math.min(attemptCount, 5)) * 60_000).toISOString();
}

async function setup(
  admin: Admin,
  job: LifecycleReminderJob,
  contract: keyof typeof TEMPLATE_CONTRACTS
) {
  const [{ data: config }, { data: templates }] = await Promise.all([
    admin.from('whatsapp_config').select('status').eq('account_id', job.account_id).maybeSingle(),
    admin.from('message_templates').select('*').eq('account_id', job.account_id).eq('name', TEMPLATE_CONTRACTS[contract].payload.name),
  ]);
  const readiness = evaluateTemplateReadiness(templates, contract, 'en_US');
  if (!config || config.status !== 'connected') return { code: 'whatsapp_not_connected' as const };
  if (!readiness.ready) return { code: readiness.code };
  return { language: readiness.row.language ?? 'en_US' };
}

/**
 * Sends factual, transaction-keyed events. It intentionally does not reserve
 * the daily chasing budget: confirmations/retry status are facts, while all
 * debt collection jobs still use the existing reservation RPC.
 */
export async function processTransactionEventJob(input: {
  admin: Admin;
  job: LifecycleReminderJob;
  account: Account;
  now: Date;
  finish: Finish;
  findConversation: FindConversation;
  markProviderAttempt: () => Promise<void>;
  reserveDailyClaim: ReserveDailyClaim;
}): Promise<TransactionEventResult> {
  const { admin, job, account, now, finish, findConversation, markProviderAttempt, reserveDailyClaim } = input;
  const { data: rawSettings, error: settingsError } = await admin
    .from('renewal_reminder_settings')
    .select('payment_confirmations_enabled, payment_confirmations_activated_at, payment_confirmations_generation, autopay_recovery_enabled, autopay_recovery_activated_at, autopay_recovery_generation')
    .eq('account_id', job.account_id)
    .maybeSingle();
  if (settingsError || !rawSettings) {
    await finish('blocked', { reason: { code: 'transaction_event_settings_unavailable' } });
    return 'blocked';
  }
  const settings = eventSettings(rawSettings as Record<string, unknown>);
  const isConfirmation = job.kind === 'payment_confirmation';
  if (isConfirmation && (!settings.payment_confirmations_enabled || settings.payment_confirmations_generation !== job.activation_generation)) {
    await finish('skipped', { reason: { code: 'payment_confirmations_disabled_or_regenerated' } });
    return 'skipped';
  }
  if (!isConfirmation && (!settings.autopay_recovery_enabled || settings.autopay_recovery_generation !== job.activation_generation)) {
    await finish('skipped', { reason: { code: 'autopay_recovery_disabled_or_regenerated' } });
    return 'skipped';
  }

  const locale = resolveAccountLocale({
    timezone: account.timezone,
    locale: account.locale,
    country_code: account.country_code,
    date_order: account.date_order,
    time_format: account.time_format,
    week_start: account.week_start,
    phone_country_code: account.phone_country_code,
    measurement_system: account.measurement_system,
    default_currency: account.default_currency,
  });
  const fmt = buildFormatters(locale);
  let contract: keyof typeof TEMPLATE_CONTRACTS;
  let contactName = 'there';
  let params: string[];

  if (isConfirmation) {
    const { data: payment, error } = await admin
      .from('payments')
      .select('id, account_id, contact_id, invoice_id, amount, status, created_at, paid_at, payment_purpose, invoice:invoices(invoice_number), contact:contacts(name)')
      .eq('account_id', job.account_id).eq('id', job.payment_id).maybeSingle();
    if (error) throw error;
    const row = payment as { id: string; contact_id: string | null; invoice_id: string | null; amount: number; status: string; created_at: string; paid_at: string; invoice: { invoice_number: string | null } | null; contact: { name: string | null } | null } | null;
    if (!row || row.id !== job.payment_id || row.contact_id !== job.contact_id || row.status !== 'paid' || !settings.payment_confirmations_activated_at || new Date(row.created_at) < new Date(settings.payment_confirmations_activated_at)) {
      await finish('skipped', { reason: { code: 'payment_not_a_new_committed_confirmation' } });
      return 'skipped';
    }
    contactName = row.contact?.name?.trim() || contactName;
    const reason = (job as LifecycleReminderJob & { reason?: { renewed?: boolean; period_end?: string | null } }).reason;
    const renewed = reason?.renewed === true && typeof reason.period_end === 'string';
    const outcome = renewed && reason?.period_end
      ? `This payment renewed your membership until ${fmt.date(reason.period_end)}.`
      : 'This payment confirmation does not confirm a membership renewal.';
    params = [contactName, fmt.money(Number(row.amount)), row.invoice?.invoice_number ?? `payment ${row.id.slice(0, 8).toUpperCase()}`, outcome];
    contract = 'payment_confirmation';
  } else {
    const { data: failure, error } = await admin
      .from('razorpay_autopay_failure_events')
      .select('id, event_kind, invoice_id, contact_id, observed_at, superseded_at, mandate:payment_mandates(id, membership_id, status, provider_subscription_status)')
      .eq('account_id', job.account_id).eq('id', job.autopay_failure_event_id).maybeSingle();
    if (error) throw error;
    const event = failure as { id: string; event_kind: 'retry_pending' | 'terminal'; invoice_id: string | null; contact_id: string; superseded_at: string | null; mandate: { id: string; membership_id: string; status: string; provider_subscription_status: string | null } | null } | null;
    if (!event || event.id !== job.autopay_failure_event_id || event.contact_id !== job.contact_id || event.superseded_at || !event.mandate) {
      await finish('skipped', { reason: { code: 'autopay_failure_superseded_or_missing' } });
      return 'skipped';
    }
    const { data: invoiceData, error: invoiceError } = event.invoice_id
      ? await admin.from('invoice_balances').select('id, invoice_number, balance, state, requires_refund_review, contact:contacts(name, phone)').eq('account_id', job.account_id).eq('id', event.invoice_id).maybeSingle()
      : { data: null, error: null };
    if (invoiceError) throw invoiceError;
    const invoice = invoiceData as { id: string; invoice_number: string | null; balance: number; state: string; requires_refund_review: boolean; contact: { name: string | null; phone: string | null } | null } | null;
    contactName = invoice?.contact?.name?.trim() || contactName;
    if (event.event_kind === 'retry_pending') {
      if (event.mandate.status !== 'active' && event.mandate.status !== 'pending' || event.mandate.provider_subscription_status !== 'pending') {
        await finish('skipped', { reason: { code: 'autopay_retry_state_changed' } });
        return 'skipped';
      }
      params = [contactName, 'your membership'];
      contract = 'autopay_recovery_pending';
    } else {
      if (!invoice || !isCollectibleInvoice({ state: invoice.state, balance: Number(invoice.balance), requiresRefundReview: invoice.requires_refund_review })) {
        await finish('blocked', { reason: { code: 'manual_fallback_needs_staff_review' } });
        return 'blocked';
      }
      const { data: openCommitments, error: commitmentsError } = await admin.from('invoice_collection_commitments')
        .select('id').eq('account_id', job.account_id).eq('invoice_id', invoice.id).eq('state', 'open');
      if (commitmentsError) {
        await finish('queued', { reason: { code: 'commitment_hold_lookup_unavailable' }, nextAttemptAt: retryAt(job.attempt_count, now) });
        return 'failed';
      }
      if ((openCommitments ?? []).length > 0) {
        await finish('deferred', { reason: { code: 'invoice_commitment_or_hold_open' }, nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() });
        return 'deferred';
      }
      const { data: healthy, error: healthyError } = await admin.from('payment_mandates').select('id').eq('account_id', job.account_id).eq('membership_id', event.mandate.membership_id).eq('status', 'active').limit(1);
      if (healthyError) throw healthyError;
      if ((healthy ?? []).length) {
        await finish('skipped', { reason: { code: 'healthy_mandate_now_covers_obligation' } });
        return 'skipped';
      }
      params = [contactName, invoice.invoice_number ?? `#${invoice.id.slice(0, 8).toUpperCase()}`, fmt.money(Number(invoice.balance))];
      contract = 'autopay_recovery_terminal';
    }
  }

  const readiness = await setup(admin, job, contract);
  if ('code' in readiness) {
    await finish('blocked', { reason: { code: readiness.code ?? 'template_not_ready' } });
    return 'blocked';
  }
  if (!isConfirmation && contract === 'autopay_recovery_terminal') {
    let reservation: 'reserved' | 'deferred';
    try {
      reservation = await reserveDailyClaim(todayInTz(locale.timeZone, now));
    } catch {
      await finish('queued', { reason: { code: 'daily_coordination_unavailable' }, nextAttemptAt: retryAt(job.attempt_count, now) });
      return 'failed';
    }
    if (reservation !== 'reserved') {
      await finish('deferred', { reason: { code: 'daily_contact_budget' }, nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString() });
      return 'deferred';
    }
  }
  let providerStarted = false;
  try {
    await finish('attempting');
    const conversationId = await findConversation(job.account_id, account.owner_user_id, job.contact_id);
    const result = await engineSendTemplate({
      beforeSend: async () => {
        // State is read again at the provider boundary. If a success/refund/
        // hold appears while the job is leased, the old fact cannot send.
        const { data: finalSettings, error: finalSettingsError } = await admin.from('renewal_reminder_settings')
          .select('payment_confirmations_enabled, payment_confirmations_generation, autopay_recovery_enabled, autopay_recovery_generation')
          .eq('account_id', job.account_id).maybeSingle();
        if (finalSettingsError) throw new Error('transaction_event_settings_lookup_unavailable');
        const final = eventSettings(finalSettings as Record<string, unknown> | null);
        if (isConfirmation ? !final.payment_confirmations_enabled || final.payment_confirmations_generation !== job.activation_generation : !final.autopay_recovery_enabled || final.autopay_recovery_generation !== job.activation_generation) throw new Error('event_configuration_changed');
        if (isConfirmation) {
          const { data: latestPayment, error: latestPaymentError } = await admin.from('payments')
            .select('status, invoice_id')
            .eq('account_id', job.account_id).eq('id', job.payment_id).maybeSingle();
          if (latestPaymentError) throw new Error('payment_confirmation_lookup_unavailable');
          const currentPayment = latestPayment as { status: string; invoice_id: string | null } | null;
          if (!currentPayment || currentPayment.status !== 'paid') {
            throw new Error('payment_confirmation_state_changed');
          }
          if (currentPayment.invoice_id) {
            const { data: latestInvoice, error: latestInvoiceError } = await admin.from('invoice_balances').select('requires_refund_review')
              .eq('account_id', job.account_id).eq('id', currentPayment.invoice_id).maybeSingle();
            // An invoice-linked payment cannot be confirmed while the
            // authoritative invoice is unreadable *or absent*. Treating an
            // absent row as "not under review" would make a failed lookup
            // look like a safe factual receipt.
            if (latestInvoiceError || !latestInvoice) {
              throw new Error('payment_confirmation_invoice_unavailable');
            }
            if ((latestInvoice as { requires_refund_review: boolean }).requires_refund_review) throw new Error('payment_confirmation_state_changed');
          }
        } else {
          const { data: latest, error: latestFailureError } = await admin.from('razorpay_autopay_failure_events')
            .select('superseded_at, event_kind, invoice_id, mandate:payment_mandates(membership_id, status, provider_subscription_status)')
            .eq('account_id', job.account_id).eq('id', job.autopay_failure_event_id).maybeSingle();
          if (latestFailureError) throw new Error('autopay_failure_lookup_unavailable');
          const currentFailure = latest as { superseded_at: string | null; event_kind: 'retry_pending' | 'terminal'; invoice_id: string | null; mandate: { membership_id: string; status: string; provider_subscription_status: string | null } | null } | null;
          if (!currentFailure || currentFailure.superseded_at || !currentFailure.mandate) throw new Error('autopay_failure_superseded');
          if (currentFailure.event_kind === 'retry_pending') {
            if ((currentFailure.mandate.status !== 'active' && currentFailure.mandate.status !== 'pending') || currentFailure.mandate.provider_subscription_status !== 'pending') {
              throw new Error('autopay_retry_state_changed');
            }
          } else {
            if (!currentFailure.invoice_id) throw new Error('autopay_terminal_state_changed');
            const [{ data: latestInvoice, error: latestInvoiceError }, { data: openCommitments, error: commitmentsError }, { data: healthy, error: healthyError }] = await Promise.all([
              admin.from('invoice_balances').select('id, invoice_number, state, balance, requires_refund_review').eq('account_id', job.account_id).eq('id', currentFailure.invoice_id).maybeSingle(),
              admin.from('invoice_collection_commitments').select('id').eq('account_id', job.account_id).eq('invoice_id', currentFailure.invoice_id).eq('state', 'open'),
              admin.from('payment_mandates').select('id').eq('account_id', job.account_id).eq('membership_id', currentFailure.mandate.membership_id).eq('status', 'active').limit(1),
            ]);
            if (latestInvoiceError || healthyError) throw new Error('autopay_terminal_state_lookup_unavailable');
            if (commitmentsError) throw new Error('autopay_terminal_commitment_lookup_unavailable');
            if ((openCommitments ?? []).length > 0) throw new Error('autopay_terminal_commitment_open');
            const invoice = latestInvoice as { id: string; invoice_number: string | null; state: string; balance: number; requires_refund_review: boolean } | null;
            if (!invoice || !isCollectibleInvoice({ state: invoice.state, balance: Number(invoice.balance), requiresRefundReview: invoice.requires_refund_review }) || (healthy ?? []).length) {
              throw new Error('autopay_terminal_state_changed');
            }
            params[1] = invoice.invoice_number ?? `#${invoice.id.slice(0, 8).toUpperCase()}`;
            params[2] = fmt.money(Number(invoice.balance));
          }
        }
        await markProviderAttempt();
        providerStarted = true;
      },
      accountId: job.account_id, userId: account.owner_user_id, conversationId,
      contactId: job.contact_id, templateName: TEMPLATE_CONTRACTS[contract].payload.name,
      language: readiness.language, params,
    });
    await finish('accepted', { providerMessageId: result.whatsapp_message_id });
    return 'accepted';
  } catch (error) {
    const code = error instanceof Error ? error.message : 'provider_request_failed';
    if (code === 'event_configuration_changed' || code === 'payment_confirmation_state_changed' || code === 'autopay_failure_superseded' || code === 'autopay_retry_state_changed' || code === 'autopay_terminal_state_changed') {
      await finish('skipped', { reason: { code } });
      return 'skipped';
    }
    if (code === 'autopay_terminal_commitment_open') {
      await finish('deferred', { reason: { code }, nextAttemptAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() });
      return 'deferred';
    }
    if (
      code === 'transaction_event_settings_lookup_unavailable' ||
      code === 'payment_confirmation_lookup_unavailable' ||
      code === 'payment_confirmation_invoice_unavailable' ||
      code === 'autopay_failure_lookup_unavailable' ||
      code === 'autopay_terminal_state_lookup_unavailable' ||
      code === 'autopay_terminal_commitment_lookup_unavailable'
    ) {
      await finish('queued', { reason: { code }, nextAttemptAt: retryAt(job.attempt_count, now) });
      return 'failed';
    }
    if (providerStarted) {
      await finish('ambiguous', { reason: { code: 'provider_outcome_unknown' } });
      return 'ambiguous';
    }
    await finish('queued', { reason: { code: 'provider_request_failed' }, nextAttemptAt: retryAt(job.attempt_count, now) });
    return 'failed';
  }
}
