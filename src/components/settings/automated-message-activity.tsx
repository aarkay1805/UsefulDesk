'use client';

import Link from 'next/link';
import * as React from 'react';
import {
  AlertCircle,
  History,
  ListTodo,
  MessageCircle,
  ReceiptText,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { EmptyState } from '@/components/dashboard/empty-state';
import { Skeleton } from '@/components/dashboard/skeleton';
import { MemberIdentity } from '@/components/members/member-identity';
import {
  TableSkeletonRows,
  type TableSkeletonColumn,
} from '@/components/table/table-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { BRANCH_HEADER, branchHref } from '@/lib/auth/branch-context';
import { getErrorMessage } from '@/lib/errors';
import type { LocaleFormatters } from '@/lib/locale/format';
import type {
  ReminderDiagnosticKind,
  ReminderDiagnosticState,
} from '@/lib/memberships/reminder-readiness';
import {
  ACTIVITY_OUTCOMES,
  activityReason,
  type AutomatedMessageActivityOutcome,
  type AutomatedMessageActivityRow,
} from '@/lib/reminders/activity';
import {
  REMINDER_RULE_GROUP_LABELS,
  REMINDER_RULE_GROUPS,
  REMINDER_RULES,
  type ReminderRuleId,
} from '@/lib/reminders/rules';
import { cn } from '@/lib/utils';
import { SettingsSectionHead } from './settings-panel-head';

type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
type ReviewRule = (id: string) => void;

type ActivityResponse = {
  items: AutomatedMessageActivityRow[];
  nextCursor: string | null;
};
type Diagnostic = {
  kind: ReminderDiagnosticKind;
  state: ReminderDiagnosticState;
  reason: string;
};

type OutcomeGroup = 'attention' | 'pending' | 'sent' | 'other';

/** Filter order: the outcomes an owner acts on come first. */
const OUTCOME_GROUPS: { id: OutcomeGroup; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'pending', label: 'Not sent yet' },
  { id: 'sent', label: 'Sent' },
  { id: 'other', label: 'Other' },
];

const OUTCOMES: Record<
  AutomatedMessageActivityOutcome,
  { label: string; variant: BadgeVariant; group: OutcomeGroup }
> = {
  waiting: { label: 'Waiting', variant: 'neutral', group: 'pending' },
  paused: { label: 'Paused', variant: 'warning', group: 'pending' },
  attempting: { label: 'Sending', variant: 'info', group: 'pending' },
  accepted: {
    label: 'Accepted by WhatsApp',
    variant: 'info',
    group: 'sent',
  },
  delivered: { label: 'Delivered', variant: 'success', group: 'sent' },
  read: { label: 'Read', variant: 'success', group: 'sent' },
  // Blocked also covers member details such as a missing phone number, so it
  // is not labelled as a setup problem.
  blocked: { label: 'Blocked', variant: 'warning', group: 'attention' },
  stopped: { label: 'Stopped', variant: 'neutral', group: 'other' },
  failed: { label: 'Failed', variant: 'danger', group: 'attention' },
  ambiguous: { label: 'Needs review', variant: 'warning', group: 'attention' },
  unconfirmed: { label: 'Unconfirmed', variant: 'neutral', group: 'other' },
};

/**
 * The activity view stores one date per record (`scheduled_for`); what that
 * date means depends on the rule that queued the message. Verified against
 * each worker's `effective_due_on` and the legacy ledgers' anchor columns.
 */
const RULE_DATE_LABEL: Record<ReminderRuleId, string> = {
  membership_renewal: 'Expiry',
  service_renewal: 'Expiry',
  membership_post_expiry: 'Expiry',
  service_post_expiry: 'Expiry',
  membership_win_back: 'Expiry',
  service_win_back: 'Expiry',
  session_pack: 'Expiry',
  invoice_collection: 'Due date',
  joining_installments: 'Due date',
  promise_to_pay: 'Promised date',
  payment_link_follow_up: 'Link sent',
  autopay_recovery: 'AutoPay failed',
  freeze_return: 'Return date',
  payment_confirmation: 'Payment date',
};

const RULE_TITLE = new Map<string, string>(
  REMINDER_RULES.map((rule) => [rule.id, rule.title])
);

const DIAGNOSTIC_RULE: Record<ReminderDiagnosticKind, ReminderRuleId> = {
  membership_renewal: 'membership_renewal',
  service_renewal: 'service_renewal',
  installment_reminder: 'joining_installments',
};

const DIAGNOSTIC_STATE: Record<
  ReminderDiagnosticState,
  { label: string; variant: BadgeVariant }
> = {
  ready: { label: 'Can send now', variant: 'info' },
  deferred: { label: 'Waiting', variant: 'neutral' },
  no_eligible: { label: 'Nothing due', variant: 'neutral' },
  blocked: { label: 'Blocked', variant: 'warning' },
  disabled: { label: 'Off', variant: 'neutral' },
};

const HISTORY_COLUMNS = [
  {
    label: 'Name',
    variant: 'identity',
    headClassName: 'pl-0',
    cellClassName: 'pl-0',
  },
  { label: 'Message', variant: 'stacked' },
  { label: 'Recorded', variant: 'stacked' },
  { label: 'Status', variant: 'badge' },
  {
    label: 'Actions',
    variant: 'actions',
    headClassName: 'pr-0 text-right',
    cellClassName: 'pr-0',
  },
] as const satisfies readonly TableSkeletonColumn[];

/** Card rows share one rhythm: the card's own padding frames the first and
 * last rows, and a hairline separates the rest. */
const ROW_CLASS =
  'border-border border-b py-3 first:pt-0 last:border-b-0 last:pb-0';

/** Narrow: name and state share a line, the reason sits beneath. Wide: one
 * aligned line per schedule, so the states read down a column. */
const READINESS_ROW_CLASS =
  'flex flex-col gap-1 @xl/activity:grid @xl/activity:grid-cols-[10rem_6.5rem_minmax(0,1fr)_auto] @xl/activity:items-center @xl/activity:gap-x-3';

/** Keyboard focus for text links, matching the product's 3px ring. */
const TEXT_LINK_FOCUS =
  'rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

const ALL = 'all';

function ruleTitle(id: string) {
  return RULE_TITLE.get(id) ?? id;
}

function ruleHref(ruleId: string, accountId: string | null) {
  return branchHref(`/settings?tab=reminders&rule=${ruleId}`, accountId);
}

/** Inside Settings the rule opens in place; elsewhere the link navigates. */
function reviewRuleOnClick(ruleId: string, onReviewRule?: ReviewRule) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onReviewRule) return;
    event.preventDefault();
    onReviewRule(ruleId);
  };
}

function branchHeaders(accountId: string | null) {
  return accountId ? { [BRANCH_HEADER]: accountId } : undefined;
}

function scheduledLine(
  row: AutomatedMessageActivityRow,
  fmt: LocaleFormatters
): string | null {
  if (!row.scheduled_for) return null;
  const label = RULE_DATE_LABEL[row.rule_id as ReminderRuleId] ?? 'Date';
  return `${label}: ${fmt.date(row.scheduled_for)}`;
}

/** Bounded, tenant-scoped history beneath a live readiness check. Empty
 * history is deliberately neutral: it makes no claim about whether a rule
 * currently has eligible members. */
export function AutomatedMessageActivity({
  onReviewRule,
}: { onReviewRule?: ReviewRule } = {}) {
  const { accountId } = useAuth();
  return (
    <div className="@container/activity space-y-8">
      <ScheduleReadiness accountId={accountId} onReviewRule={onReviewRule} />
      <MessageHistory accountId={accountId} onReviewRule={onReviewRule} />
    </div>
  );
}

/** A live, no-PII check of the three scheduled reminder workers. It says
 * nothing about history, and history says nothing about eligibility. */
function ScheduleReadiness({
  accountId,
  onReviewRule,
}: {
  accountId: string | null;
  onReviewRule?: ReviewRule;
}) {
  const [diagnostics, setDiagnostics] = React.useState<Diagnostic[] | null>(
    null
  );
  const [failed, setFailed] = React.useState(false);
  const [reloadNonce, setReloadNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setDiagnostics(null);
      setFailed(false);
      try {
        const response = await fetch('/api/reminders/readiness', {
          headers: branchHeaders(accountId),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) throw new Error();
        if (!cancelled) setDiagnostics(body.diagnostics ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadNonce]);

  return (
    <section
      aria-labelledby="automated-message-readiness-heading"
      className="space-y-3"
    >
      <SettingsSectionHead
        id="automated-message-readiness-heading"
        title="Renewal and installment checks"
        description="Checks membership renewals, service renewals, and installment reminders only."
      />
      <Card>
        <CardContent>
          {failed ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-destructive">
                Couldn’t check reminder readiness.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadNonce((value) => value + 1)}
              >
                Try again
              </Button>
            </div>
          ) : diagnostics === null ? (
            <ul aria-busy="true">
              <li className="sr-only" role="status">
                Checking reminder readiness
              </li>
              {Object.keys(DIAGNOSTIC_RULE).map((kind) => (
                <li
                  key={kind}
                  aria-hidden="true"
                  className={cn(ROW_CLASS, READINESS_ROW_CLASS)}
                >
                  <div className="flex items-center justify-between gap-2 @xl/activity:contents">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-3/5" />
                </li>
              ))}
            </ul>
          ) : diagnostics.length === 0 ? (
            <p className="text-muted-foreground">
              No scheduled reminders to check.
            </p>
          ) : (
            <ul>
              {diagnostics.map((item) => (
                <ReadinessRow
                  key={item.kind}
                  diagnostic={item}
                  accountId={accountId}
                  onReviewRule={onReviewRule}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ReadinessRow({
  diagnostic,
  accountId,
  onReviewRule,
}: {
  diagnostic: Diagnostic;
  accountId: string | null;
  onReviewRule?: ReviewRule;
}) {
  const ruleId = DIAGNOSTIC_RULE[diagnostic.kind];
  const state: { label: string; variant: BadgeVariant } = DIAGNOSTIC_STATE[
    diagnostic.state
  ] ?? { label: 'Unknown', variant: 'neutral' };
  return (
    <li className={cn(ROW_CLASS, READINESS_ROW_CLASS)}>
      <div className="flex items-center justify-between gap-2 @xl/activity:contents">
        <span className="font-medium">
          {ruleId ? ruleTitle(ruleId) : diagnostic.kind}
        </span>
        <Badge variant={state.variant}>{state.label}</Badge>
      </div>
      <p className="text-muted-foreground text-pretty">{diagnostic.reason}</p>
      {diagnostic.state === 'blocked' && ruleId ? (
        <Link
          href={ruleHref(ruleId, accountId)}
          onClick={reviewRuleOnClick(ruleId, onReviewRule)}
          data-slot="button"
          className={cn(
            buttonVariants({ variant: 'link', size: 'sm' }),
            '-ml-2.5 self-start @xl/activity:ml-0'
          )}
        >
          Review message
        </Link>
      ) : null}
    </li>
  );
}

/** Permission and filter problems keep the server's explanation. A server or
 * network failure throws an empty message, so the caller's retry copy shows
 * instead of "Internal server error". */
async function readActivity(
  search: string,
  accountId: string | null
): Promise<ActivityResponse> {
  const response = await fetch(`/api/reminders/activity?${search}`, {
    headers: branchHeaders(accountId),
  }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (response?.ok && body) return body as ActivityResponse;
  const explained =
    response !== null &&
    response.status < 500 &&
    typeof body?.error === 'string';
  throw new Error(explained ? body.error : '');
}

function MessageHistory({
  accountId,
  onReviewRule,
}: {
  accountId: string | null;
  onReviewRule?: ReviewRule;
}) {
  const { fmt } = useLocale();
  const today = fmt.today();
  const [rule, setRule] = React.useState(ALL);
  const [outcome, setOutcome] = React.useState(ALL);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [items, setItems] = React.useState<AutomatedMessageActivityRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const requestVersion = React.useRef(0);
  const filtered = rule !== ALL || outcome !== ALL || Boolean(from || to);

  const query = React.useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (rule !== ALL) params.set('rule', rule);
      if (outcome !== ALL) params.set('outcome', outcome);
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
      setLoadMoreError(null);
      try {
        const payload = await readActivity(query(), accountId);
        if (!cancelled && version === requestVersion.current) {
          setItems(payload.items);
          setNextCursor(payload.nextCursor);
        }
      } catch (cause) {
        if (!cancelled && version === requestVersion.current) {
          setItems([]);
          setNextCursor(null);
          setError(
            getErrorMessage(cause, 'Check your connection, then try again.')
          );
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
    setLoadMoreError(null);
    try {
      const payload = await readActivity(query(nextCursor), accountId);
      if (version === requestVersion.current) {
        setItems((current) => [...current, ...payload.items]);
        setNextCursor(payload.nextCursor);
      }
    } catch (cause) {
      if (version === requestVersion.current)
        setLoadMoreError(
          getErrorMessage(cause, 'Older messages couldn’t load. Try again.')
        );
    } finally {
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setRule(ALL);
    setOutcome(ALL);
    setFrom('');
    setTo('');
  }

  return (
    <section
      aria-labelledby="automated-message-history-heading"
      className="space-y-3"
    >
      <SettingsSectionHead
        id="automated-message-history-heading"
        title="Message history"
        description="Automated messages and their latest status, newest first."
      />

      <div className="grid grid-cols-2 gap-3 @2xl/activity:flex @2xl/activity:flex-wrap @2xl/activity:items-end">
        <div className="col-span-2 grid gap-1.5 @2xl/activity:w-56">
          <Label htmlFor="automated-message-rule" size="sm">
            Message
          </Label>
          <Select
            value={rule}
            onValueChange={(value) => setRule(String(value ?? ALL))}
          >
            <SelectTrigger id="automated-message-rule" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All messages</SelectItem>
              {REMINDER_RULE_GROUPS.map((group) => (
                <SelectGroup key={group}>
                  <SelectLabel>{REMINDER_RULE_GROUP_LABELS[group]}</SelectLabel>
                  {REMINDER_RULES.filter((item) => item.group === group).map(
                    (item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    )
                  )}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 grid gap-1.5 @2xl/activity:w-36">
          <Label htmlFor="automated-message-outcome" size="sm">
            Status
          </Label>
          <Select
            value={outcome}
            onValueChange={(value) => setOutcome(String(value ?? ALL))}
          >
            <SelectTrigger id="automated-message-outcome" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {OUTCOME_GROUPS.map((group) => (
                <SelectGroup key={group.id}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {ACTIVITY_OUTCOMES.filter(
                    (value) => OUTCOMES[value].group === group.id
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {OUTCOMES[value].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 @2xl/activity:w-36">
          <Label htmlFor="automated-message-from" size="sm">
            From
          </Label>
          <DatePicker
            id="automated-message-from"
            value={from}
            onChange={setFrom}
            max={to || today}
            aria-label="Recorded from"
          />
        </div>
        <div className="grid gap-1.5 @2xl/activity:w-36">
          <Label htmlFor="automated-message-to" size="sm">
            To
          </Label>
          <DatePicker
            id="automated-message-to"
            value={to}
            onChange={setTo}
            min={from || undefined}
            max={today}
            aria-label="Recorded to"
          />
        </div>
        {filtered ? (
          <Button
            variant="link"
            size="sm"
            onClick={clearFilters}
            className="col-span-2 -ml-2.5 justify-self-start @2xl/activity:mb-0.5 @2xl/activity:ml-0"
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Message history couldn’t load</AlertTitle>
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
      ) : !loading && items.length === 0 ? (
        <EmptyState
          icon={History}
          className="min-h-48"
          title={
            filtered
              ? 'No messages match these filters'
              : 'No messages recorded yet'
          }
          hint={
            filtered
              ? 'Try a different message, status, or date range.'
              : 'Messages appear here once a message type queues or sends one. The checks above cover renewals and installments only.'
          }
        />
      ) : (
        <Card>
          <CardContent>
            <HistoryList
              rows={items}
              loading={loading}
              accountId={accountId}
              onReviewRule={onReviewRule}
            />
            <HistoryTable
              rows={items}
              loading={loading}
              accountId={accountId}
              onReviewRule={onReviewRule}
            />
          </CardContent>
        </Card>
      )}

      {nextCursor && !loading && !error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="outline" onClick={loadMore} loading={loadingMore}>
            Load older messages
          </Button>
          {loadMoreError ? (
            <p role="alert" className="text-destructive text-sm">
              {loadMoreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type RowLink = {
  key: string;
  /** Visible label where the action is spelled out. */
  label: string;
  /** Accessible name and tooltip where the action is an icon. */
  action: string;
  icon: LucideIcon;
  href: string | null;
};

/** Relevant destinations for this history record. */
function rowLinks(
  row: AutomatedMessageActivityRow,
  accountId: string | null
): RowLink[] {
  const contactName = row.contact_name?.trim() || 'this member';
  return [
    {
      key: 'conversation',
      label: 'Open chat',
      action: `Open chat with ${contactName}`,
      icon: MessageCircle,
      href: row.conversation_id
        ? branchHref(`/inbox?c=${row.conversation_id}`, accountId)
        : null,
    },
    {
      key: 'invoice',
      label: 'Invoice',
      action: `View invoice for ${contactName}`,
      icon: ReceiptText,
      href: row.invoice_id
        ? branchHref(
            `/finance?view=invoices&invoice=${row.invoice_id}`,
            accountId
          )
        : null,
    },
    {
      // The newest open follow-up for this contact, which a reminder may not
      // have created; it opens the profile where that work lives.
      key: 'follow-up',
      label: 'Follow-up',
      action: `View follow-up for ${contactName}`,
      icon: ListTodo,
      href: row.follow_up_id
        ? branchHref(
            `/members?contact=${row.contact_id}&view=followups`,
            accountId
          )
        : null,
    },
    {
      key: 'member',
      label: 'View member',
      action: `View member ${contactName}`,
      icon: UserRound,
      href: memberHref(row, accountId),
    },
  ];
}

function memberHref(
  row: AutomatedMessageActivityRow,
  accountId: string | null
) {
  return branchHref(
    row.membership_id
      ? `/members?member=${row.membership_id}`
      : `/members?contact=${row.contact_id}`,
    accountId
  );
}

function RuleLink({
  ruleId,
  accountId,
  onReviewRule,
}: {
  ruleId: string;
  accountId: string | null;
  onReviewRule?: ReviewRule;
}) {
  return (
    <Link
      href={ruleHref(ruleId, accountId)}
      onClick={reviewRuleOnClick(ruleId, onReviewRule)}
      className={cn(
        'hover:text-primary-text transition-colors',
        TEXT_LINK_FOCUS
      )}
    >
      {ruleTitle(ruleId)}
    </Link>
  );
}

function OutcomeBadge({
  outcome,
}: {
  outcome: AutomatedMessageActivityOutcome;
}) {
  const presentation: { label: string; variant: BadgeVariant } = OUTCOMES[
    outcome
  ] ?? { label: outcome, variant: 'neutral' };
  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
}

function ActivityExplanation({
  row,
  className,
}: {
  row: AutomatedMessageActivityRow;
  className?: string;
}) {
  const hasProviderDetails = Boolean(
    row.provider_error_title || row.provider_error_detail
  );
  return (
    <div className={className}>
      <p className="text-muted-foreground text-pretty">{activityReason(row)}</p>
      {hasProviderDetails ? (
        <Accordion className="mt-1">
          <AccordionItem value="provider-details">
            <AccordionTrigger>Provider details</AccordionTrigger>
            <AccordionContent>
              {row.provider_error_title ? (
                <p className="break-words">
                  <span className="font-medium">Title:</span>{' '}
                  {row.provider_error_title}
                </p>
              ) : null}
              {row.provider_error_detail ? (
                <p className="break-words">
                  <span className="font-medium">Detail:</span>{' '}
                  {row.provider_error_detail}
                </p>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </div>
  );
}

/** Narrow containers: one self-contained record per row, actions spelled out
 * because a touch screen has no hover to reveal an icon's name. */
function HistoryList({
  rows,
  loading,
  accountId,
  onReviewRule,
}: {
  rows: AutomatedMessageActivityRow[];
  loading: boolean;
  accountId: string | null;
  onReviewRule?: ReviewRule;
}) {
  const { fmt } = useLocale();
  if (loading) {
    return (
      <ul aria-busy="true" className="@3xl/activity:hidden">
        <li className="sr-only" role="status">
          Loading message history
        </li>
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} aria-hidden="true" className={ROW_CLASS}>
            <div className="flex items-center justify-between gap-3 @xl/activity:justify-start">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-4 w-40" />
            <Skeleton className="mt-1.5 h-3 w-56" />
            <Skeleton className="mt-3 h-4 w-4/5" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="@3xl/activity:hidden">
      {rows.map((row) => {
        const dateLine = scheduledLine(row, fmt);
        const links = rowLinks(row, accountId).filter((link) => link.href);
        return (
          <li key={row.activity_id} className={ROW_CLASS}>
            {/* On a phone the outcome takes the far edge; with more width it
                stays beside the name instead of across a wide gutter. */}
            <div className="flex items-center justify-between gap-3 @xl/activity:justify-start">
              <MemberIdentity
                name={row.contact_name}
                src={row.contact_avatar_url}
                size="sm"
              />
              <OutcomeBadge outcome={row.outcome} />
            </div>
            <div className="mt-2">
              <RuleLink
                ruleId={row.rule_id}
                accountId={accountId}
                onReviewRule={onReviewRule}
              />
              {/* Each fact wraps as a unit, so a narrow screen never strands
                  half a date on its own line. */}
              <p className="text-muted-foreground text-xs tabular-nums">
                {dateLine ? (
                  <>
                    <span className="whitespace-nowrap">{dateLine}</span>
                    {' · '}
                  </>
                ) : null}
                <span className="whitespace-nowrap">
                  Recorded {fmt.dateTime(row.occurred_at)}
                </span>
              </p>
            </div>
            <ActivityExplanation row={row} className="mt-2" />
            {row.next_attempt_at ? (
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                Next attempt: {fmt.dateTime(row.next_attempt_at)}
              </p>
            ) : null}
            <div className="mt-2 -ml-2.5 flex flex-wrap gap-1">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.key}
                    href={link.href!}
                    aria-label={link.action}
                    data-slot="button"
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    <Icon aria-hidden="true" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Wide containers: fixed tracks so the outcome and its explanation take the
 * remaining width instead of wrapping into a sliver. */
function HistoryTable({
  rows,
  loading,
  accountId,
  onReviewRule,
}: {
  rows: AutomatedMessageActivityRow[];
  loading: boolean;
  accountId: string | null;
  onReviewRule?: ReviewRule;
}) {
  const { fmt } = useLocale();
  return (
    <div className="hidden @3xl/activity:block">
      <TooltipProvider>
        <Table className="table-fixed" aria-busy={loading || undefined}>
          <TableCaption className="sr-only">
            Automated message history
          </TableCaption>
          <colgroup>
            <col className="w-40" />
            <col className="w-48" />
            <col className="w-28" />
            <col />
            <col className="w-44" />
          </colgroup>
          <TableHeader>
            <TableRow interactive={false}>
              {HISTORY_COLUMNS.map((column) => (
                <TableHead
                  key={column.label}
                  className={
                    'headClassName' in column ? column.headClassName : undefined
                  }
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows
                columns={HISTORY_COLUMNS}
                rows={5}
                label="Loading message history"
              />
            ) : (
              rows.map((row) => {
                const dateLine = scheduledLine(row, fmt);
                return (
                  <TableRow key={row.activity_id} interactive={false}>
                    <TableCell className="pl-0">
                      {/* Mouse shortcut only; the Member action is the
                          keyboard path, so the row has one tab stop for it. */}
                      <Link
                        href={memberHref(row, accountId)}
                        tabIndex={-1}
                        className="block min-w-0"
                      >
                        <MemberIdentity
                          name={row.contact_name}
                          src={row.contact_avatar_url}
                          size="sm"
                        />
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <RuleLink
                        ruleId={row.rule_id}
                        accountId={accountId}
                        onReviewRule={onReviewRule}
                      />
                      {dateLine ? (
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {dateLine}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <time dateTime={row.occurred_at}>
                        <span className="block">
                          {fmt.date(row.occurred_at)}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {fmt.time(row.occurred_at)}
                        </span>
                      </time>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <OutcomeBadge outcome={row.outcome} />
                      <ActivityExplanation row={row} className="mt-1 text-xs" />
                      {row.next_attempt_at ? (
                        <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                          Next attempt: {fmt.dateTime(row.next_attempt_at)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="pr-0">
                      <div className="flex flex-wrap justify-end gap-0.5">
                        {rowLinks(row, accountId)
                          .filter((link) => link.href)
                          .map((link) => (
                            <Tooltip key={link.key}>
                              <TooltipTrigger
                                delay={350}
                                render={
                                  <Link
                                    href={link.href!}
                                    aria-label={link.action}
                                    data-slot="button"
                                    className={buttonVariants({
                                      variant: 'ghost',
                                      size: 'xs',
                                    })}
                                  />
                                }
                              >
                                {link.label}
                              </TooltipTrigger>
                              <TooltipContent>{link.action}</TooltipContent>
                            </Tooltip>
                          ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TooltipProvider>
    </div>
  );
}
