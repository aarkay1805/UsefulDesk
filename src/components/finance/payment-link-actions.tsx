'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { GatedButton } from '@/components/ui/gated-button';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canManagePaymentLinks } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { PAYMENT_LINK_TEMPLATE_NAME } from '@/lib/payments/payment-link-constants';
import { createClient } from '@/lib/supabase/client';
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

function PaymentLinkStatusBadge({
  status,
}: {
  status: BrowserPaymentLink['status'];
}) {
  if (status === 'created') return <Badge variant="info">Active</Badge>;
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
          supabase.from('whatsapp_config').select('status').maybeSingle(),
          supabase
            .from('message_templates')
            .select('language, status')
            .eq('name', PAYMENT_LINK_TEMPLATE_NAME)
            .eq('status', 'APPROVED')
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
        const approvedTemplate = templateResult.data;
        setTemplateReady(
          configResult.data?.status === 'connected' && Boolean(approvedTemplate)
        );
        setTemplateLanguage(approvedTemplate?.language ?? 'en_US');
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
  const sendReady = providerReady && templateReady && hasPhone;
  const sendReason = !providerReady
    ? providerReason
    : !hasPhone
      ? 'Add a phone number before sending on WhatsApp'
      : !templateReady
        ? `Connect WhatsApp and approve the ${PAYMENT_LINK_TEMPLATE_NAME} template`
        : null;
  const active = link?.status === 'created' && link.shortUrl;

  return (
    <>
      {link ? (
        <span className="mr-auto inline-flex items-center gap-2 text-xs">
          <PaymentLinkStatusBadge status={link.status} />
          {active && link.expiresAt ? (
            <span className="text-muted-foreground tabular-nums">
              Expires {fmt.dateTime(link.expiresAt)}
            </span>
          ) : null}
        </span>
      ) : null}
      <GatedButton
        type="button"
        variant="outline"
        canAct={canManage}
        gateReason="create payment links"
        disabled={readinessLoading || creatingFor !== null || !providerReady}
        title={providerReason ?? undefined}
        onClick={copyLink}
      >
        {creatingFor === 'copy' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : copied ? (
          <Check className="size-4" />
        ) : active ? (
          <Copy className="size-4" />
        ) : (
          <Link2 className="size-4" />
        )}
        Copy link
      </GatedButton>
      <GatedButton
        type="button"
        canAct={canManage}
        gateReason="send payment links"
        disabled={readinessLoading || creatingFor !== null || !sendReady}
        title={sendReason ?? undefined}
        onClick={sendLink}
      >
        {creatingFor === 'send' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MessageCircle className="size-4" />
        )}
        Send payment link
      </GatedButton>
    </>
  );
}
