'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ArrowRight, Banknote } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { MemberIdentity } from '@/components/members/member-identity';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { branchHref } from '@/lib/auth/branch-context';
import type {
  FinanceRevenueBreakdown,
  FinanceRevenuePayment,
  FinanceRevenueStream,
} from '@/lib/finance/overview';
import { financeHref } from '@/lib/finance/views';
import type { LocaleFormatters } from '@/lib/locale/format';
import type { PaymentMethod, PaymentPurpose } from '@/types';

const FinanceMemberDetailSheet = dynamic(() =>
  import('@/components/finance/finance-member-detail-sheet').then(
    (module) => module.FinanceMemberDetailSheet
  )
);

const PURPOSE_ROWS: Array<{
  key: PaymentPurpose;
  label: string;
}> = [
  { key: 'joining', label: 'New memberships' },
  { key: 'renewal', label: 'Renewals' },
  { key: 'due', label: 'Due payments recovered' },
  { key: 'other', label: 'Other collections' },
];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

const REVENUE_GRID_COLUMNS = 'grid-cols-[minmax(11rem,1fr)_5rem_5rem_8rem]';

function paymentContext(
  purpose: PaymentPurpose,
  payment: FinanceRevenuePayment,
  fmt: LocaleFormatters
): string | null {
  if (purpose === 'joining' && payment.membershipStartDate) {
    return `Joined ${fmt.date(payment.membershipStartDate)}`;
  }
  if (purpose === 'renewal' && payment.periodEnd) {
    return `Renewed through ${fmt.date(payment.periodEnd)}`;
  }
  if (purpose === 'due' && payment.periodEnd) {
    return `Billing period ended ${fmt.date(payment.periodEnd)}`;
  }
  return null;
}

export function FinanceRevenueBreakdownCard({
  breakdown,
  streams,
  month,
  accountId,
  fmt,
  onChanged,
}: {
  breakdown: FinanceRevenueBreakdown;
  streams: FinanceRevenueStream[];
  month: string;
  accountId: string | null;
  fmt: LocaleFormatters;
  onChanged: () => void;
}) {
  const [expandedSources, setExpandedSources] = useState<PaymentPurpose[]>([]);
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(
    null
  );
  const total = Object.values(breakdown).reduce(
    (sum, amount) => sum + amount,
    0
  );
  const rows = PURPOSE_ROWS.filter(
    (row) => row.key !== 'other' || breakdown.other > 0
  );
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Revenue sources</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {total > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[42rem]">
              <div className="border-border border-b">
                <div
                  role="row"
                  className="text-muted-foreground mx-4 flex h-10 items-center border border-transparent text-sm font-medium"
                >
                  <span
                    className={`grid min-w-0 flex-1 items-center ${REVENUE_GRID_COLUMNS}`}
                  >
                    <span className="pl-10">Revenue source</span>
                    <span className="text-right">Payments</span>
                    <span className="text-right">Share</span>
                    <span className="text-right">Revenue</span>
                  </span>
                </div>
              </div>
              <Accordion multiple value={expandedSources}>
                {rows.map((row) => {
                  const stream = streams.find(
                    (item) => item.purpose === row.key
                  ) ?? {
                    purpose: row.key,
                    payments: 0,
                    amount: breakdown[row.key],
                    recentPayments: [],
                  };
                  const percent = Math.round((stream.amount / total) * 100);
                  const paymentsHref = branchHref(
                    financeHref('payments', month, [row.key]),
                    accountId
                  );

                  return (
                    <AccordionItem key={row.key} value={row.key}>
                      <AccordionTrigger
                        className="hover:bg-muted/50 rounded-none px-4 hover:no-underline **:data-[slot=accordion-trigger-icon]:absolute **:data-[slot=accordion-trigger-icon]:top-1/2 **:data-[slot=accordion-trigger-icon]:left-4 **:data-[slot=accordion-trigger-icon]:ml-0 **:data-[slot=accordion-trigger-icon]:-translate-y-1/2"
                        onClick={() =>
                          setExpandedSources((current) =>
                            current.includes(row.key)
                              ? current.filter((value) => value !== row.key)
                              : [...current, row.key]
                          )
                        }
                      >
                        <span
                          className={`grid min-w-0 flex-1 items-center ${REVENUE_GRID_COLUMNS}`}
                        >
                          <span className="min-w-0 truncate pl-10 font-medium">
                            {row.label}
                          </span>
                          <span className="text-right tabular-nums">
                            {fmt.number(stream.payments)}
                          </span>
                          <span className="text-muted-foreground text-right tabular-nums">
                            {fmt.number(percent)}%
                          </span>
                          <span className="text-right font-medium tabular-nums">
                            {fmt.money(stream.amount)}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        {stream.recentPayments.length > 0 ? (
                          <>
                            <Table className="table-fixed">
                              <colgroup>
                                <col className="w-[45%]" />
                                <col className="w-[22%]" />
                                <col className="w-[18%]" />
                                <col className="w-[15%]" />
                              </colgroup>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="pl-14">
                                    Member
                                  </TableHead>
                                  <TableHead>Collected on</TableHead>
                                  <TableHead>Collection</TableHead>
                                  <TableHead className="pr-4 text-right">
                                    Revenue
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {stream.recentPayments.map((payment) => {
                                  const membershipId = payment.membershipId;
                                  const context = paymentContext(
                                    row.key,
                                    payment,
                                    fmt
                                  );
                                  const memberMeta = [
                                    payment.planName,
                                    payment.memberNumber
                                      ? `Member ID ${payment.memberNumber}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ');

                                  return (
                                    <TableRow
                                      key={payment.id}
                                      className={
                                        membershipId
                                          ? 'cursor-pointer'
                                          : undefined
                                      }
                                      tabIndex={membershipId ? 0 : undefined}
                                      aria-label={
                                        membershipId
                                          ? `Open ${payment.contactName ?? 'member'} details`
                                          : undefined
                                      }
                                      onClick={
                                        membershipId
                                          ? () =>
                                              setDetailMembershipId(
                                                membershipId
                                              )
                                          : undefined
                                      }
                                      onKeyDown={
                                        membershipId
                                          ? (event) => {
                                              if (
                                                event.currentTarget !==
                                                event.target
                                              ) {
                                                return;
                                              }
                                              if (
                                                event.key === 'Enter' ||
                                                event.key === ' '
                                              ) {
                                                event.preventDefault();
                                                setDetailMembershipId(
                                                  membershipId
                                                );
                                              }
                                            }
                                          : undefined
                                      }
                                    >
                                      <TableCell className="pl-14">
                                        <MemberIdentity
                                          name={
                                            payment.contactName ??
                                            'Deleted member'
                                          }
                                          src={payment.contactAvatarUrl}
                                          size="sm"
                                          meta={
                                            memberMeta ? (
                                              <div className="text-muted-foreground truncate text-xs">
                                                {memberMeta}
                                              </div>
                                            ) : undefined
                                          }
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <div className="grid gap-0.5">
                                          <span className="tabular-nums">
                                            {fmt.date(payment.paidAt)}
                                          </span>
                                          {context ? (
                                            <span className="text-muted-foreground truncate text-xs">
                                              {context}
                                            </span>
                                          ) : null}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <div className="grid justify-items-start gap-1">
                                          <span>
                                            {METHOD_LABEL[payment.method]}
                                          </span>
                                          <Badge
                                            variant={
                                              payment.source === 'auto'
                                                ? 'info'
                                                : 'neutral'
                                            }
                                          >
                                            {payment.source === 'auto'
                                              ? 'Auto-pay'
                                              : 'Manual'}
                                          </Badge>
                                        </div>
                                      </TableCell>
                                      <TableCell className="pr-4 text-right font-medium tabular-nums">
                                        {fmt.money(payment.amount)}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                            <div className="border-border flex justify-end border-t px-4 py-2">
                              <Link
                                data-slot="button"
                                href={paymentsHref}
                                className={buttonVariants({
                                  variant: 'link',
                                  size: 'sm',
                                })}
                              >
                                View all {row.label.toLowerCase()}
                                <ArrowRight />
                              </Link>
                            </div>
                          </>
                        ) : (
                          <p className="text-muted-foreground py-3 pr-4 pl-14 text-sm">
                            No collections in this revenue source.
                          </p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          </div>
        ) : (
          <div className="px-4">
            <EmptyState
              icon={Banknote}
              className="min-h-52"
              title="No revenue in this month"
            />
          </div>
        )}
      </CardContent>
      {detailMembershipId ? (
        <FinanceMemberDetailSheet
          membershipId={detailMembershipId}
          onOpenChange={(open) => {
            if (!open) setDetailMembershipId(null);
          }}
          onChanged={onChanged}
        />
      ) : null}
    </Card>
  );
}
