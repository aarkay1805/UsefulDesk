'use client';

import Link from 'next/link';
import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { MemberIdentity } from '@/components/members/member-identity';
import { TableSkeletonRows } from '@/components/table/table-skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { branchHref } from '@/lib/auth/branch-context';
import { BRANCH_HEADER } from '@/lib/auth/branch-context';
import {
  ACTIVITY_OUTCOMES,
  activityReason,
  type AutomatedMessageActivityOutcome,
  type AutomatedMessageActivityRow,
} from '@/lib/reminders/activity';
import { REMINDER_RULES } from '@/lib/reminders/rules';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';

type ActivityResponse = {
  items: AutomatedMessageActivityRow[];
  nextCursor: string | null;
};
type Diagnostic = { kind: string; state: string; reason: string };

const outcomePresentation: Record<
  AutomatedMessageActivityOutcome,
  {
    label: string;
    variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }
> = {
  waiting: { label: 'Waiting', variant: 'neutral' },
  paused: { label: 'Paused', variant: 'warning' },
  attempting: { label: 'Attempting', variant: 'info' },
  accepted: { label: 'Accepted', variant: 'info' },
  delivered: { label: 'Delivered', variant: 'success' },
  read: { label: 'Read', variant: 'success' },
  blocked: { label: 'Setup blocked', variant: 'warning' },
  stopped: { label: 'Stopped', variant: 'neutral' },
  failed: { label: 'Failed', variant: 'danger' },
  ambiguous: { label: 'Needs review', variant: 'warning' },
  unconfirmed: { label: 'Unconfirmed', variant: 'neutral' },
};
const activityColumns = [
  { label: 'Name', variant: 'identity' },
  { label: 'Rule' },
  { label: 'Recorded' },
  { label: 'Outcome', variant: 'badge' },
  { label: 'Reason', variant: 'stacked' },
  { label: 'Actions', variant: 'actions' },
] as const;

/** Bounded, tenant-scoped history. Empty history is deliberately neutral: it
 * does not make a claim about whether a rule currently has eligible members. */
export function AutomatedMessageActivity({
  onReviewRule,
}: { onReviewRule?: (id: string) => void } = {}) {
  const { accountId } = useAuth();
  const { fmt } = useLocale();
  const [rule, setRule] = React.useState('all');
  const [outcome, setOutcome] = React.useState('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [items, setItems] = React.useState<AutomatedMessageActivityRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const [diagnostics, setDiagnostics] = React.useState<Diagnostic[] | null>(
    null
  );
  const [diagnosticError, setDiagnosticError] = React.useState(false);
  const requestVersion = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setDiagnostics(null);
      setDiagnosticError(false);
      try {
        const response = await fetch('/api/reminders/readiness', {
          headers: accountId ? { [BRANCH_HEADER]: accountId } : undefined,
        });
        const body = await response.json();
        if (!response.ok) throw new Error();
        if (!cancelled) {
          setDiagnostics(body.diagnostics ?? []);
          setDiagnosticError(false);
        }
      } catch {
        if (!cancelled) setDiagnosticError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadNonce]);

  const query = React.useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (rule !== 'all') params.set('rule', rule);
      if (outcome !== 'all') params.set('outcome', outcome);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    },
    [from, outcome, rule, to]
  );

  React.useEffect(() => {
    let cancelled = false;
    const version = ++requestVersion.current;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/reminders/activity?${query()}`, {
          headers: accountId ? { [BRANCH_HEADER]: accountId } : undefined,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || 'Activity could not be loaded.');
        if (!cancelled && version === requestVersion.current) {
          const payload = body as ActivityResponse;
          setItems(payload.items);
          setNextCursor(payload.nextCursor);
        }
      } catch (cause) {
        if (!cancelled && version === requestVersion.current) {
          setItems([]);
          setNextCursor(null);
          setError(getErrorMessage(cause, 'Activity could not be loaded.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, query, reloadNonce]);

  async function loadMore() {
    if (!nextCursor) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/reminders/activity?${query(nextCursor)}`,
        { headers: accountId ? { [BRANCH_HEADER]: accountId } : undefined }
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'More activity could not be loaded.');
      const payload = body as ActivityResponse;
      if (version === requestVersion.current) {
        setItems((current) => [...current, ...payload.items]);
        setNextCursor(payload.nextCursor);
      }
    } catch (cause) {
      if (version === requestVersion.current)
        setError(getErrorMessage(cause, 'More activity could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="automated-message-rule" size="sm">
            Rule
          </Label>
          <Select
            value={rule}
            onValueChange={(value) => setRule(String(value))}
          >
            <SelectTrigger id="automated-message-rule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rules</SelectItem>
              {REMINDER_RULES.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="automated-message-outcome" size="sm">
            Outcome
          </Label>
          <Select
            value={outcome}
            onValueChange={(value) => setOutcome(String(value))}
          >
            <SelectTrigger id="automated-message-outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              {ACTIVITY_OUTCOMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {outcomePresentation[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label size="sm">From</Label>
          <DatePicker
            value={from}
            onChange={setFrom}
            aria-label="Activity from date"
          />
        </div>
        <div className="grid gap-1.5">
          <Label size="sm">To</Label>
          <DatePicker
            value={to}
            onChange={setTo}
            aria-label="Activity to date"
          />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Activity couldn’t load</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-3"
              onClick={() => setReloadNonce((value) => value + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium">Current renewal schedule checks</p>
        <p className="text-muted-foreground text-xs">
          These three diagnostics cover membership, service, and
          joining-installment schedules only. They show whether work is
          currently due; the activity table covers all recorded rules.
        </p>
        {diagnosticError ? (
          <p className="text-destructive text-xs">
            Current schedule checks couldn’t load.
          </p>
        ) : diagnostics ? (
          <div className="space-y-1">
            {diagnostics.map((item) => (
              <p key={item.kind} className="text-muted-foreground text-xs">
                <Badge
                  variant={
                    item.state === 'blocked'
                      ? 'warning'
                      : item.state === 'no_eligible' ||
                          item.state === 'disabled'
                        ? 'neutral'
                        : 'info'
                  }
                >
                  {item.kind === 'membership_renewal'
                    ? 'Membership renewal'
                    : item.kind === 'service_renewal'
                      ? 'Service renewal'
                      : 'Joining installments'}{' '}
                  ·{' '}
                  {item.state === 'no_eligible'
                    ? 'Nothing due'
                    : item.state === 'deferred'
                      ? 'Waiting'
                      : item.state === 'blocked'
                        ? 'Setup blocked'
                        : item.state === 'disabled'
                          ? 'Off'
                          : 'Ready'}
                </Badge>{' '}
                {item.reason}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Loading current schedule checks…
          </p>
        )}
      </div>
      {loading ? (
        <Table aria-busy="true">
          <TableHeader>
            <TableRow interactive={false}>
              {activityColumns.map((column) => (
                <TableHead key={column.label}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableSkeletonRows
              columns={activityColumns}
              rows={5}
              label="Loading automated message activity"
            />
          </TableBody>
        </Table>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="text-muted-foreground py-12 text-sm">
          No recorded activity matches these filters. This does not mean no
          members are eligible.
        </p>
      ) : null}
      {!loading && items.length ? (
        <Table>
          <TableHeader>
            <TableRow interactive={false}>
              <TableHead>Name</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => {
              const status = outcomePresentation[row.outcome];
              const memberHref = branchHref(
                row.membership_id
                  ? `/members?member=${row.membership_id}`
                  : `/members?contact=${row.contact_id}`,
                accountId
              );
              const identity = (
                <MemberIdentity
                  name={row.contact_name}
                  src={row.contact_avatar_url}
                  size="sm"
                />
              );
              return (
                <TableRow key={row.activity_id} interactive={false}>
                  <TableCell>
                    <Link href={memberHref}>{identity}</Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={branchHref(
                        `/settings?tab=reminders&rule=${row.rule_id}`,
                        accountId
                      )}
                      onClick={(event) => {
                        if (onReviewRule) {
                          event.preventDefault();
                          onReviewRule(row.rule_id);
                        }
                      }}
                    >
                      {REMINDER_RULES.find((item) => item.id === row.rule_id)
                        ?.title || row.rule_id}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      Anchor:{' '}
                      {row.scheduled_for
                        ? fmt.date(row.scheduled_for)
                        : 'event'}
                    </p>
                  </TableCell>
                  <TableCell>{fmt.dateTime(row.occurred_at)}</TableCell>
                  <TableCell>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-80 whitespace-normal">
                    {activityReason(row)}
                    {row.next_attempt_at ? (
                      <p>Next attempt: {fmt.dateTime(row.next_attempt_at)}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        nativeButton={false}
                        render={<Link href={memberHref} />}
                        variant="ghost"
                        size="sm"
                      >
                        Member
                      </Button>
                      {row.invoice_id ? (
                        <Button
                          nativeButton={false}
                          render={
                            <Link
                              href={branchHref(
                                `/finance?view=invoices&invoice=${row.invoice_id}`,
                                accountId
                              )}
                            />
                          }
                          variant="ghost"
                          size="sm"
                        >
                          Invoice
                        </Button>
                      ) : null}
                      {row.conversation_id ? (
                        <Button
                          nativeButton={false}
                          render={
                            <Link
                              href={branchHref(
                                `/inbox?c=${row.conversation_id}`,
                                accountId
                              )}
                            />
                          }
                          variant="ghost"
                          size="sm"
                        >
                          Conversation
                        </Button>
                      ) : null}
                      {row.follow_up_id ? (
                        <Button
                          nativeButton={false}
                          render={
                            <Link
                              href={branchHref(
                                `/members?contact=${row.contact_id}&view=followups`,
                                accountId
                              )}
                            />
                          }
                          variant="ghost"
                          size="sm"
                        >
                          View profile
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      {nextCursor ? (
        <Button variant="outline" onClick={loadMore} loading={loadingMore}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
