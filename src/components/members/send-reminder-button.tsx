'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle, Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import type { LocaleFormatters } from '@/lib/locale/format';
import type { Membership } from '@/types';
import { Button } from '@/components/ui/button';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';
import {
  RENEWAL_TEMPLATE_NAME,
  RENEWAL_TEMPLATE_NAMES,
} from '@/lib/memberships/renewal-reminders';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';

// RENEWAL_TEMPLATE_NAME now lives in the server-safe lib so the cron can
// share it; re-exported here to keep existing import sites working.
export { RENEWAL_TEMPLATE_NAME };

export interface ReminderResolution {
  /** CTA label, e.g. "Open WhatsApp settings". */
  label: string;
  /** Where the fix lives. */
  href: string;
}

export interface ReminderReadiness {
  loading: boolean;
  /** True when WhatsApp is connected AND the renewal template is approved. */
  ready: boolean;
  /** Human-readable blocker when not ready. */
  reason: string | null;
  /** How to clear the blocker (settings deep-link), when there is one. */
  resolution: ReminderResolution | null;
  /** The approved template's language, passed through on send. */
  templateLanguage: string;
  /** Exact approved Marketing template selected for the send. */
  templateName: string;
}

/**
 * One-shot check that the one-tap reminder can actually send: WhatsApp
 * must be connected and the exact renewal contract approved by Meta as
 * Marketing. Fetched once and shared across every action-list row so we don't
 * re-query per member.
 */
export function useReminderReadiness(): ReminderReadiness {
  const { accountId } = useAuth();
  const [state, setState] = useState<ReminderReadiness>({
    loading: true,
    ready: false,
    reason: null,
    resolution: null,
    templateLanguage: 'en_US',
    templateName: RENEWAL_TEMPLATE_NAME,
  });

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const [{ data: config }, { data: templates }] = await Promise.all([
        supabase
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .in('name', [...RENEWAL_TEMPLATE_NAMES]),
      ]);
      if (cancelled) return;

      const readiness = evaluateTemplateReadiness(
        templates,
        'membership_renewal',
        'en_US'
      );

      if (!config || config.status !== 'connected') {
        setState({
          loading: false,
          ready: false,
          reason:
            "WhatsApp isn't connected yet. Connect it to send renewal reminders.",
          resolution: {
            label: 'Connect WhatsApp',
            href: '/settings?tab=whatsapp',
          },
          templateLanguage: 'en_US',
          templateName: RENEWAL_TEMPLATE_NAME,
        });
        return;
      }
      if (!readiness.ready) {
        setState({
          loading: false,
          ready: false,
          reason: readiness.message,
          resolution: {
            label: 'Go to Templates',
            href: '/settings?tab=templates',
          },
          templateLanguage: 'en_US',
          templateName: RENEWAL_TEMPLATE_NAME,
        });
        return;
      }
      setState({
        loading: false,
        ready: true,
        reason: null,
        resolution: null,
        templateLanguage: readiness.row.language ?? 'en_US',
        templateName: readiness.row.name ?? RENEWAL_TEMPLATE_NAME,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return state;
}

/**
 * Send the renewal template to one member via `/api/whatsapp/send`
 * (contact_id path → the route find-or-creates the conversation, so a
 * member who never messaged still gets reached). Throws on failure —
 * callers own the toast/tally (the single button toasts per send, the
 * bulk toolbar reports one tally).
 */
export async function sendRenewalReminder(
  membership: Membership,
  readiness: ReminderReadiness,
  fmt: LocaleFormatters
): Promise<void> {
  // {{3}} expiry + {{4}} fee rendered the way the gym writes them
  // (locale settings, migration 055) — mirrors the cron's params.
  const params = buildMembershipRenewalParams(membership, fmt);
  const res = await fetch('/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contact_id: membership.contact_id,
      message_type: 'template',
      template_name: readiness.templateName,
      template_language: readiness.templateLanguage,
      template_message_params: { body: params },
      template_params: params,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || 'Failed to send reminder');
  }
}

export function buildMembershipRenewalParams(
  membership: Membership,
  fmt: Pick<LocaleFormatters, 'date' | 'money'>
): string[] {
  return [
    membership.contact?.name?.trim() || 'there',
    membership.plan?.name || 'membership',
    fmt.date(membership.end_date),
    fmt.money(membership.fee_amount),
  ];
}

interface SendReminderButtonProps {
  membership: Membership;
  readiness: ReminderReadiness;
  /** Called after a reminder is successfully sent. */
  onSent?: () => void;
  size?: 'sm' | 'default';
  /** Rows stay quiet; profile surfaces may give the same action an edge. */
  variant?: 'ghost' | 'outline';
}

/**
 * Sends the renewal template to a member via the existing
 * `/api/whatsapp/send` route (contact_id path → the route find-or-creates
 * the conversation, so a member who never messaged still gets reached).
 */
export function SendReminderButton({
  membership,
  readiness,
  onSent,
  size = 'sm',
  variant = 'ghost',
}: SendReminderButtonProps) {
  const { fmt } = useLocale();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const phone = membership.contact?.phone?.trim();
  const hasPhone = !!phone;

  // Reset the "Reminded ✓" flash when the row's membership changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) setSent(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [membership.id, membership.end_date]);

  // A missing phone is a per-member blocker with no settings fix; the
  // readiness blockers (WhatsApp / template) carry a deep-link resolution.
  const blockedReason = !hasPhone
    ? "This member has no phone number, so there's nothing to send the reminder to. Add a phone number to their contact first."
    : readiness.reason;
  const resolution = !hasPhone ? null : readiness.resolution;
  const blocked = !hasPhone || !readiness.ready;
  const blocker: ActionBlocker | null = blocked
    ? {
        title: !hasPhone
          ? 'Phone number required'
          : "WhatsApp reminder isn't ready",
        description: blockedReason ?? 'Complete WhatsApp setup before sending.',
        resolution: resolution
          ? { label: resolution.label, href: resolution.href }
          : undefined,
      }
    : null;

  // While the readiness check is in flight, sit inert rather than pretend
  // to be blocked.
  const disabled = sending || sent || readiness.loading;

  const send = useCallback(async () => {
    if (blocked) return;
    setSending(true);
    try {
      await sendRenewalReminder(membership, readiness, fmt);
      setSent(true);
      toast.success('Reminder sent on WhatsApp');
      onSent?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to send reminder'
      );
    } finally {
      setSending(false);
    }
  }, [blocked, readiness, membership, fmt, onSent]);

  return (
    <ResolvableAction
      trigger={
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          title={blockedReason ?? 'Send a WhatsApp renewal reminder'}
          loading={sending}
        >
          {sent ? (
            <Check className="size-3.5" />
          ) : (
            <MessageCircle className="size-3.5" />
          )}
          {sent ? 'Reminded' : 'Remind'}
        </Button>
      }
      onAction={send}
      blocker={blocker}
    />
  );
}
