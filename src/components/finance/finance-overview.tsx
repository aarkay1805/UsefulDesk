'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Receipt,
} from 'lucide-react';

import { PaymentSummaryTiles } from '@/components/members/payment-summary-tiles';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useLocale } from '@/hooks/use-locale';
import { financeHref } from '@/lib/finance/views';
import { isChargeableAmount } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';

interface FinanceOverviewProps {
  reloadKey: number;
}

interface AttentionTotals {
  dueCount: number;
  dueAmount: number;
  failedMandates: number;
}

const ZERO: AttentionTotals = {
  dueCount: 0,
  dueAmount: 0,
  failedMandates: 0,
};

export function FinanceOverview({ reloadKey }: FinanceOverviewProps) {
  const { fmt } = useLocale();
  const [attention, setAttention] = useState<AttentionTotals>(ZERO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      const [duesResult, mandatesResult] = await Promise.all([
        supabase.from('membership_dues').select('membership_id, balance'),
        supabase
          .from('payment_mandates')
          .select('membership_id, status')
          .in('status', ['failed', 'active']),
      ]);
      if (cancelled) return;

      const loadError = duesResult.error ?? mandatesResult.error;
      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }

      const dues = (duesResult.data ?? [])
        .map((row) => Number(row.balance) || 0)
        .filter(isChargeableAmount);
      const mandateStatuses = new Map<string, Set<string>>();
      for (const row of mandatesResult.data ?? []) {
        const statuses =
          mandateStatuses.get(row.membership_id) ?? new Set<string>();
        statuses.add(row.status);
        mandateStatuses.set(row.membership_id, statuses);
      }

      setAttention({
        dueCount: dues.length,
        dueAmount: dues.reduce((sum, amount) => sum + amount, 0),
        failedMandates: Array.from(mandateStatuses.values()).filter(
          (statuses) => statuses.has('failed') && !statuses.has('active')
        ).length,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const items = [
    {
      label: 'Outstanding dues',
      detail: loading
        ? 'Loading current balances…'
        : `${fmt.money(attention.dueAmount)} still to collect`,
      value: loading ? '—' : fmt.number(attention.dueCount),
      icon: CircleDollarSign,
      href: financeHref('collections', 'due'),
    },
    {
      label: 'Failed AutoPay',
      detail: 'Members who need a manual collection fallback',
      value: loading ? '—' : fmt.number(attention.failedMandates),
      icon: CreditCard,
      href: financeHref('collections', 'due'),
    },
    {
      label: 'Recent payments',
      detail: 'Review collection method, proof, and recorder',
      value: null,
      icon: Receipt,
      href: financeHref('collections', 'recent'),
    },
  ];

  return (
    <div className="space-y-5">
      <PaymentSummaryTiles reloadKey={reloadKey} />

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load collection queues</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>
            Live collection queues, ordered by what needs action
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="focus-visible:ring-ring hover:bg-muted/60 flex min-w-0 items-center gap-3 rounded-lg p-2.5 transition-colors outline-none focus-visible:ring-2"
            >
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <item.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm font-medium">
                  {item.label}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {item.detail}
                </span>
              </span>
              {item.value ? (
                <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
                  {item.value}
                </span>
              ) : null}
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
