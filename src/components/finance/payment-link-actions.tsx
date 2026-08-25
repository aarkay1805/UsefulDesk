'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canManagePaymentLinks } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { PAYMENT_LINK_TEMPLATE_NAME } from '@/lib/payments/payment-link-constants';
import { createClient } from '@/lib/supabase/client';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import type { Membership } from '@/types';

interface BrowserPaymentLink {
  id: string;
  revision: number;
  shortUrl: string | null;
  short_url?: string | null;
  expiresAt: string;
  expires_at?: string;
  status:
    | 'creating'
    | 'created'
    | 'cancel_requested'
    | 'paid'
    | 'cancelled'
    | 'expired'
    | 'orphaned'
    | 'failed';
}

const PAYMENT_LINK_PERMISSION_BLOCKER: ActionBlocker = {
  title: 'Admin access required',
  description:
    'Only an agent, admin, or owner can create and send payment links.',
};

const PHONE_BLOCKER: ActionBlocker = {
  title: 'Phone number required',
  description:
    'Add a phone number to this member before sending a payment link on WhatsApp.',
};

function paymentProviderBlocker(reason: string | null): ActionBlocker {
  const normalized = reason?.toLowerCase() ?? '';
  if (
    normalized.includes('reconnect razorpay') ||
    normalized.includes('razorpay needs attention')
  ) {
    return {
      title: 'Payment setup required',
      description: reason ?? 'Open payment setup to restore Razorpay.',
      resolution: {
        label: 'Open payment setup',
        href: '/settings?tab=payments',
      },
    };
  }
  if (
    normalized.includes('connect razorpay') ||
    normalized.includes("razorpay isn't connected")
  ) {
    return {
      title: "Razorpay isn't connected",
      description:
        reason === "Razorpay isn't connected"
          ? 'Connect Razorpay before creating a payment link.'
          : (reason ?? 'Connect Razorpay before creating a payment link.'),
      resolution: {
        label: 'Connect Razorpay',
        href: '/settings?tab=payments',
      },
    };
  }
  return {
    title: 'Payment link unavailable',
    description: reason ?? 'Payment Link status is unavailable.',
  };
}

function whatsappBlocker(reason: string | null): ActionBlocker {
  if (reason?.toLowerCase().includes('connect whatsapp')) {
    return {
      title: "WhatsApp isn't connected",
      description: reason,
      resolution: {
        label: 'Connect WhatsApp',
        href: '/settings?tab=whatsapp',
      },
    };
  }
  return {
    title: "Payment link template isn't ready",
    description:
      reason ??
      `Approve and sync the exact ${PAYMENT_LINK_TEMPLATE_NAME} template before sending.`,
    resolution: {
      label: 'Open template setup',
      href: '/settings?tab=templates',
    },
  };
}

function PaymentLinkStatusBadge({
  status,
}: {
  status: BrowserPaymentLink['status'];
}) {
  if (status === 'created') {
    return <Badge variant="info">Payment link active</Badge>;
  }
  if (status === 'paid') return <Badge variant="success">Paid</Badge>;
  if (status === 'creating' || status === 'cancel_requested') {
    return <Badge variant="warning">Updating</Badge>;
  }
  if (status === 'orphaned')
    return <Badge variant="danger">Needs review</Badge>;
  return (
    <Badge variant="neutral">{status === 'failed' ? 'Failed' : status}</Badge>
  );
}

export function PaymentLinkActions({
  invoice,
  member,
}: {
  invoice: { id: string; reference: string; balance: number };
  member: Membership | null;
}) {
  const { accountId, accountRole } = useAuth();
  const { fmt } = useLocale();
  const canManage = accountRole ? canManagePaymentLinks(accountRole) : false;
  const [link, setLink] = useState<BrowserPaymentLink | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [providerReason, setProviderReason] = useState<string | null>(null);
  const [templateReady, setTemplateReady] = useState(false);
  const [templateReason, setTemplateReason] = useState<string | null>(null);
  const [templateLanguage, setTemplateLanguage] = useState('en_US');
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [creatingFor, setCreatingFor] = useState<'copy' | 'send' | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const [linkResponse, configResult, templateResult] = await Promise.all([
          fetch(
            `/api/payments/razorpay/payment-links?invoiceId=${encodeURIComponent(invoice.id)}`,
            { cache: 'no-store' }
          ),
          supabase
            .from('whatsapp_config')
            .select('status')
            .eq('account_id', accountId)
            .maybeSingle(),
          supabase
            .from('message_templates')
            .select('*')
            .eq('account_id', accountId)
            .eq('name', PAYMENT_LINK_TEMPLATE_NAME)
            .eq('language', 'en_US')
            .maybeSingle(),
        ]);
        const linkBody = await linkResponse.json().catch(() => ({}));
        if (cancelled) return;
        if (linkResponse.ok) {
          const latest = linkBody.link as
            | (BrowserPaymentLink & {
                short_url?: string | null;
                expires_at?: string;
              })
            | null;
          setLink(
            latest
              ? {
                  ...latest,
                  shortUrl: latest.shortUrl ?? latest.short_url ?? null,
                  expiresAt: latest.expiresAt ?? latest.expires_at ?? '',
                }
              : null
          );
          setProviderReady(Boolean(linkBody.availability?.ready));
          setProviderReason(linkBody.availability?.reason ?? null);
        } else {
          setProviderReady(false);
          setProviderReason(
            linkBody.error ?? 'Payment Link status is unavailable'
          );
        }
        const templateReadiness = evaluateTemplateReadiness(
          templateResult.data ? [templateResult.data] : [],
          'payment_link',
          'en_US'
        );
        setTemplateReady(
          configResult.data?.status === 'connected' && templateReadiness.ready
        );
        setTemplateReason(
          configResult.data?.status !== 'connected'
            ? 'Connect WhatsApp in Settings first'
            : templateReadiness.ready
              ? null
              : templateReadiness.message
        );
        setTemplateLanguage(
          templateReadiness.ready
            ? (templateReadiness.row.language ?? 'en_US')
            : 'en_US'
        );
      } catch (error) {
        if (cancelled) return;
        setProviderReady(false);
        setProviderReason(
          getErrorMessage(error, 'Payment Link status is unavailable')
        );
      } finally {
        if (!cancelled) setReadinessLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, invoice.id]);

  async function createOrReuse() {
    const response = await fetch('/api/payments/razorpay/payment-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: invoice.id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.link?.shortUrl) {
      throw new Error(body.error ?? 'Payment link could not be created');
    }
    const next = body.link as BrowserPaymentLink;
    setLink(next);
    return next;
  }

  async function copyLink() {
    setCreatingFor('copy');
    setCopied(false);
    try {
      const next = await createOrReuse();
      await navigator.clipboard.writeText(next.shortUrl!);
      setCopied(true);
      toast.success('Payment link copied');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Payment link could not be copied'));
    } finally {
      setCreatingFor(null);
    }
  }

  async function sendLink() {
    if (!member?.contact_id) return;
    setCreatingFor('send');
    try {
      const next = await createOrReuse();
      const params = [
        member.contact?.name?.trim() || 'there',
        fmt.money(invoice.balance),
        invoice.reference,
        next.shortUrl!,
      ];
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: member.contact_id,
          message_type: 'template',
          template_name: PAYMENT_LINK_TEMPLATE_NAME,
          template_language: templateLanguage,
          template_message_params: { body: params },
          template_params: params,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          `${body.error ?? 'WhatsApp send failed'}. The payment link is still available to copy.`
        );
      }
      toast.success('Payment link sent on WhatsApp');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Payment link could not be sent'));
    } finally {
      setCreatingFor(null);
    }
  }

  const hasPhone = Boolean(member?.contact?.phone?.trim());
  const providerBlocker = providerReady
    ? null
    : paymentProviderBlocker(providerReason);
  const sendReady = providerReady && templateReady && hasPhone;
  const copyBlocker = !canManage
    ? PAYMENT_LINK_PERMISSION_BLOCKER
    : providerBlocker;
  const sendBlocker = !canManage
    ? PAYMENT_LINK_PERMISSION_BLOCKER
    : sendReady
      ? null
      : !hasPhone
        ? PHONE_BLOCKER
        : providerBlocker
          ? providerBlocker
          : !templateReady
            ? whatsappBlocker(templateReason)
            : null;
  const active = link?.status === 'created' && link.shortUrl;
  const showStatus =
    link && !['paid', 'cancelled', 'expired', 'failed'].includes(link.status);

  return (
    <>
      {showStatus ? (
        <span className="mr-auto inline-flex flex-col items-start gap-1 text-xs">
          <PaymentLinkStatusBadge status={link.status} />
          {active && link.expiresAt ? (
            <span className="text-muted-foreground whitespace-nowrap tabular-nums">
              Expires {fmt.dateTime(link.expiresAt)}
            </span>
          ) : null}
        </span>
      ) : null}
      <ResolvableAction
        trigger={
          <Button
            type="button"
            variant="outline"
            disabled={canManage && creatingFor !== null}
            loading={canManage && (readinessLoading || creatingFor === 'copy')}
          >
            {copied ? (
              <Check className="size-4" />
            ) : active ? (
              <Copy className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
            Copy link
          </Button>
        }
        onAction={() => void copyLink()}
        blocker={copyBlocker}
      />
      <ResolvableAction
        trigger={
          <Button
            type="button"
            variant="outline"
            disabled={canManage && creatingFor !== null}
            loading={canManage && (readinessLoading || creatingFor === 'send')}
          >
            <MessageCircle className="size-4" />
            Send payment link
          </Button>
        }
        onAction={() => void sendLink()}
        blocker={sendBlocker}
      />
    </>
  );
}
