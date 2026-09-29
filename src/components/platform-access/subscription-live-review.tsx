'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { createClient } from '@/lib/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface LiveQuote {
  request_id: string;
  tier: 'starter' | 'growth' | 'ultimate';
  amount_minor: number;
  currency: 'INR';
  expires_at: string;
  starter_reminder_reset_accepted: boolean;
  starter_reminder_policy_version: string | null;
  approved_starter_reminder_policy: {
    version: string;
    days_before: number[];
    hour_local: number;
  } | null;
}

function isQuote(value: unknown): value is LiveQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const quote = value as Partial<LiveQuote>;
  return (
    typeof quote.request_id === 'string' &&
    ['starter', 'growth', 'ultimate'].includes(String(quote.tier)) &&
    Number.isSafeInteger(quote.amount_minor) &&
    (quote.amount_minor ?? 0) > 0 &&
    quote.currency === 'INR' &&
    typeof quote.expires_at === 'string' &&
    typeof quote.starter_reminder_reset_accepted === 'boolean'
  );
}

/** Shows only an existing owner quote. No order or payment action exists here. */
export function SubscriptionLiveReview({
  organizationId,
}: {
  organizationId: string;
}) {
  const { fmt } = useLocale();
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [renderedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: readError } = await createClient().rpc(
        'subscription_live_owner_quote',
        { p_organization_id: organizationId }
      );
      if (cancelled) return;
      if (readError) {
        setError('Could not load your plan amount. Try again.');
        return;
      }
      setError('');
      setQuote(isQuote(data) ? data : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, nonce]);

  if (!quote && !error) return null;
  const expired = quote ? Date.parse(quote.expires_at) <= renderedAt : false;
  const policy = quote?.approved_starter_reminder_policy;
  const acknowledged =
    quote?.starter_reminder_reset_accepted &&
    quote.starter_reminder_policy_version === policy?.version;

  async function acknowledge() {
    if (!quote || !policy || !accepted || pending || expired) return;
    setPending(true);
    const result = await createClient().rpc(
      'subscription_acknowledge_live_starter_reminders',
      { p_request_id: quote.request_id }
    );
    setPending(false);
    if (result.error) {
      toast.error('Could not save your reminder choice. Try again.');
      return;
    }
    toast.success('Reminder choice saved');
    setNonce((n) => n + 1);
  }

  return (
    <Alert>
      <AlertTitle>Usefulmade Live pilot</AlertTitle>
      <AlertDescription className="space-y-3">
        {error ? <p>{error}</p> : null}
        {quote ? (
          <>
            <p className="text-foreground text-lg font-semibold tabular-nums">
              {fmt.money(quote.amount_minor / 100, 'INR')} for one month
            </p>
            <p>
              {quote.tier[0].toUpperCase() + quote.tier.slice(1)} plan. Review
              this exact amount before paying.
            </p>
            <p>
              {expired
                ? 'This amount has expired. Contact support for a new amount.'
                : `This amount is valid until ${fmt.dateTime(quote.expires_at)}.`}
            </p>
            {quote.tier === 'starter' ? (
              policy ? (
                acknowledged ? (
                  <p>Starter reminder choice saved.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="live-starter-reminders"
                        checked={accepted}
                        disabled={pending || expired}
                        onCheckedChange={(checked) =>
                          setAccepted(checked === true)
                        }
                      />
                      <Label htmlFor="live-starter-reminders">
                        Use reminders {policy.days_before.join(', ')} days
                        before renewal, after {policy.hour_local}:00.
                      </Label>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!accepted || expired}
                      loading={pending}
                      onClick={() => void acknowledge()}
                    >
                      Save reminder choice
                    </Button>
                  </div>
                )
              ) : (
                <p>Starter reminders need a review. Contact support.</p>
              )
            ) : null}
            <p>Payment for this Live pilot is not available yet.</p>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
