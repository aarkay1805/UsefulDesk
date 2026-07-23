import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { FinanceRecentTransaction } from '@/lib/finance/overview';
import type { LocaleFormatters } from '@/lib/locale/format';

const METHOD_LABEL: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
  bank_other: 'Bank & other',
};

export function FinanceRecentTransactionsCard({
  transactions,
  expenseTrackingAvailable,
  fmt,
}: {
  transactions: FinanceRecentTransaction[];
  expenseTrackingAvailable: boolean;
  fmt: LocaleFormatters;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle>Recent transactions</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {transactions.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="pr-4 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((transaction) => {
                  const income = transaction.kind === 'membership';
                  return (
                    <TableRow key={`${transaction.kind}:${transaction.id}`}>
                      <TableCell className="pl-4 whitespace-nowrap">
                        {fmt.date(transaction.occurredAt)}
                      </TableCell>
                      <TableCell className="max-w-48 truncate font-medium">
                        {transaction.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant={income ? 'info' : 'danger'}>
                          {income ? 'Membership' : 'Expense'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {METHOD_LABEL[transaction.method] ?? transaction.method}
                      </TableCell>
                      <TableCell
                        className={`pr-4 text-right font-medium tabular-nums ${
                          income
                            ? 'text-emerald-foreground'
                            : 'text-red-foreground'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {income ? (
                            <ArrowDownLeft className="size-3.5" />
                          ) : (
                            <ArrowUpRight className="size-3.5" />
                          )}
                          {income ? '+' : '−'}
                          {fmt.money(transaction.amount)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!expenseTrackingAvailable ? (
              <p className="text-muted-foreground border-border border-t px-4 py-3 text-xs">
                Expense entries will join this feed when the expense ledger is
                enabled.
              </p>
            ) : null}
          </>
        ) : (
          <div className="px-4">
            <EmptyState
              icon={ArrowDownLeft}
              className="min-h-52"
              title="No transactions in this month"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
