'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  CircleAlert,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canSellProductsServices } from '@/lib/auth/roles';
import { daysUntil, effectiveStatus } from '@/lib/memberships/expiry';
import {
  loadRenewalQueueCount,
  loadRenewalQueuePage,
  type RenewalBucket,
} from '@/lib/memberships/renewal-queue';
import type { Membership } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import {
  MembershipStatusBadge,
  FeeStatusBadge,
} from './membership-status-badge';
import { MemberIdentity } from './member-identity';
import { buildMemberAvatarPreview } from './member-avatar-quick-view';
import {
  SendReminderButton,
  type ReminderReadiness,
} from './send-reminder-button';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import { FollowUpButton } from '@/components/follow-ups/follow-up-button';
import { TableSkeleton } from '@/components/table/table-skeleton';
import { RenewMembershipDialog } from './renew-membership-dialog';
import { ServiceRenewalActionLists } from './service-renewal-action-lists';

interface RenewalActionListsProps {
  readiness: ReminderReadiness;
  onSelect: (
    customer: string | { contactId: string; membershipId: string | null }
  ) => void;
  reloadKey: number;
}

interface RenewalWindow {
  value: string;
  label: string;
  days: number | null;
}

// The trailing duration control changes with the selected segment: upcoming
// windows for Expiring and lookback windows for Expired. Each segment keeps
// its own selection when the agent switches between them.
const EXPIRING_WINDOWS: RenewalWindow[] = [
  { value: '7', label: 'Next 7 days', days: 7 },
  { value: '30', label: 'Next 30 days', days: 30 },
  { value: '90', label: 'Next 3 months', days: 90 },
  { value: '180', label: 'Next 6 months', days: 180 },
];
const EXPIRED_WINDOWS: RenewalWindow[] = [
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 3 months', days: 90 },
  { value: '180', label: 'Last 6 months', days: 180 },
  { value: 'all', label: 'All time', days: null },
];
const DEFAULT_EXPIRING_WINDOW = '7';
const DEFAULT_EXPIRED_WINDOW = 'all';
interface RenewalQueueState {
  rows: Membership[];
  total: number;
  page: number;
}

export function RenewalActionLists({
  readiness,
  onSelect,
  reloadKey,
}: RenewalActionListsProps) {
  const { accountId, canSendMessages, accountRole } = useAuth();
  const { fmt } = useLocale();
  const canSell = accountRole ? canSellProductsServices(accountRole) : false;

  const [queues, setQueues] = useState<Record<string, RenewalQueueState>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bumped after a reminder/renew/assign to re-pull the buckets.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const [bucket, setBucket] = useState<RenewalBucket>('expiring');
  const [expiringWindow, setExpiringWindow] = useState(DEFAULT_EXPIRING_WINDOW);
  const [expiredWindow, setExpiredWindow] = useState(DEFAULT_EXPIRED_WINDOW);

  // Member being handed to a staff owner via the assign dialog.
  const [assigning, setAssigning] = useState<Membership | null>(null);
  // Member being renewed via the renew dialog.
  const [renewing, setRenewing] = useState<Membership | null>(null);
  const [source, setSource] = useState<'memberships' | 'services'>(
    'memberships'
  );

  const today = fmt.today();
  const activeWindowValue =
    bucket === 'expiring' ? expiringWindow : expiredWindow;
  const activeWindows =
    bucket === 'expiring' ? EXPIRING_WINDOWS : EXPIRED_WINDOWS;
  const activeDays =
    activeWindows.find((item) => item.value === activeWindowValue)?.days ??
    null;
  const queueKey = `${accountId}:${bucket}:${activeWindowValue}:${reloadKey}:${nonce}:${today}`;
  const activeQueue = queues[queueKey];

  useEffect(() => {
    if (!accountId || activeQueue?.page >= 0) return;

    let cancelled = false;
    setLoadingKey(queueKey);
    setLoadError(false);
    (async () => {
      try {
        const db = createClient();
        const otherBucket: RenewalBucket =
          bucket === 'expiring' ? 'expired' : 'expiring';
        const otherWindowValue =
          otherBucket === 'expiring' ? expiringWindow : expiredWindow;
        const otherWindows =
          otherBucket === 'expiring' ? EXPIRING_WINDOWS : EXPIRED_WINDOWS;
        const otherDays =
          otherWindows.find((item) => item.value === otherWindowValue)?.days ??
          null;
        const otherKey = `${accountId}:${otherBucket}:${otherWindowValue}:${reloadKey}:${nonce}:${today}`;
        const page = await loadRenewalQueuePage(db, {
          accountId,
          bucket,
          days: activeDays,
          today,
          page: 0,
        });
        if (cancelled) return;
        setQueues((current) => ({
          ...current,
          [queueKey]: { ...page, page: 0 },
        }));
        setLoadingKey((current) => (current === queueKey ? null : current));

        // A count for a bounded inactive window is useful context, but it must
        // never hold the selected rows behind Promise.all. The default other
        // view is all historical expiries, so defer that exact count until the
        // user actually opens Expired and the page query returns its total.
        if (otherDays === null) return;
        try {
          const otherCount = await loadRenewalQueueCount(db, {
            accountId,
            bucket: otherBucket,
            days: otherDays,
            today,
          });
          if (cancelled) return;
          setQueues((current) => ({
            ...current,
            [otherKey]: current[otherKey] ?? {
              rows: [],
              total: otherCount,
              page: -1,
            },
          }));
        } catch (error) {
          console.error('[renewal queue] inactive count failed:', error);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) {
          setLoadingKey((current) => (current === queueKey ? null : current));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    activeDays,
    activeQueue?.page,
    bucket,
    expiredWindow,
    expiringWindow,
    nonce,
    queueKey,
    reloadKey,
    today,
  ]);

  const loadNextPage = useCallback(async () => {
    if (!accountId || !activeQueue || loadingMore) return;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const nextPage = activeQueue.page + 1;
      const page = await loadRenewalQueuePage(createClient(), {
        accountId,
        bucket,
        days: activeDays,
        today,
        page: nextPage,
      });
      setQueues((current) => ({
        ...current,
        [queueKey]: {
          rows: [...(current[queueKey]?.rows ?? []), ...page.rows],
          total: page.total,
          page: nextPage,
        },
      }));
    } catch {
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [
    accountId,
    activeDays,
    activeQueue,
    bucket,
    loadingMore,
    queueKey,
    today,
  ]);

  const otherWindowValue =
    bucket === 'expiring' ? expiredWindow : expiringWindow;
  const otherBucket = bucket === 'expiring' ? 'expired' : 'expiring';
  const otherKey = `${accountId}:${otherBucket}:${otherWindowValue}:${reloadKey}:${nonce}:${today}`;
  const expiringCount =
    bucket === 'expiring'
      ? (activeQueue?.total ?? null)
      : (queues[otherKey]?.total ?? null);
  const expiredCount =
    bucket === 'expired'
      ? (activeQueue?.total ?? null)
      : (queues[otherKey]?.total ?? null);
  const emptyLabel =
    bucket === 'expiring'
      ? 'No memberships expiring in this window.'
      : 'No expired memberships in this window.';
  const sourceControl = (
    <Toolbar aria-label="Renewal source">
      <ToolbarToggleGroup<'memberships' | 'services'>
        value={[source]}
        onValueChange={(values) => {
          const next = values[0];
          if (next) setSource(next);
        }}
      >
        <ToolbarToggleItem value="memberships">Memberships</ToolbarToggleItem>
        <ToolbarToggleItem value="services">Services</ToolbarToggleItem>
      </ToolbarToggleGroup>
    </Toolbar>
  );

  return (
    <>
      {source === 'services' ? (
        <ServiceRenewalActionLists
          onSelect={onSelect}
          reloadKey={reloadKey}
          canAct={canSell}
          sourceControl={sourceControl}
        />
      ) : (
        <RenewalTable
          sourceControl={sourceControl}
          bucket={bucket}
          onBucketChange={setBucket}
          rows={activeQueue?.rows ?? []}
          expiringCount={expiringCount}
          expiredCount={expiredCount}
          windows={activeWindows}
          windowValue={activeWindowValue}
          onWindowChange={(value) => {
            if (bucket === 'expiring') setExpiringWindow(value);
            else setExpiredWindow(value);
          }}
          loading={loadingKey === queueKey}
          loadingMore={loadingMore}
          hasMore={
            Boolean(activeQueue) && activeQueue.rows.length < activeQueue.total
          }
          loadError={loadError}
          onLoadMore={loadNextPage}
          readiness={readiness}
          accountId={accountId}
          canFollowUp={canSendMessages}
          onSelect={onSelect}
          onChanged={reload}
          onAssign={canSendMessages ? setAssigning : undefined}
          onRenew={setRenewing}
          emptyLabel={emptyLabel}
        />
      )}

      {assigning && (
        <FollowUpDialog
          open={!!assigning}
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          membership={assigning}
          initialReason="renewal"
          onSaved={reload}
        />
      )}

      {renewing && (
        <RenewMembershipDialog
          open={!!renewing}
          onOpenChange={(o) => {
            if (!o) setRenewing(null);
          }}
          membership={renewing}
          onSaved={reload}
        />
      )}
    </>
  );
}

function RenewalTable({
  sourceControl,
  bucket,
  onBucketChange,
  rows,
  expiringCount,
  expiredCount,
  windows,
  windowValue,
  onWindowChange,
  loading,
  loadingMore,
  hasMore,
  loadError,
  onLoadMore,
  readiness,
  accountId,
  canFollowUp,
  onSelect,
  onChanged,
  onAssign,
  onRenew,
  emptyLabel,
}: {
  sourceControl: ReactNode;
  bucket: RenewalBucket;
  onBucketChange: (bucket: RenewalBucket) => void;
  rows: Membership[];
  expiringCount: number | null;
  expiredCount: number | null;
  windows: RenewalWindow[];
  windowValue: string;
  onWindowChange: (value: string) => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadError: boolean;
  onLoadMore: () => void;
  readiness: ReminderReadiness;
  accountId: string | null;
  canFollowUp: boolean;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Present for agent+ — opens the assign-follow-up dialog. */
  onAssign?: (m: Membership) => void;
  onRenew: (m: Membership) => void;
  emptyLabel: string;
}) {
  const { fmt } = useLocale();
  const today = fmt.today();

  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border">
      <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
        {sourceControl}
        <Toolbar aria-label="Renewal status">
          <ToolbarToggleGroup<RenewalBucket>
            aria-label="Renewal status"
            value={[bucket]}
            onValueChange={(nextBuckets) => {
              const nextBucket = nextBuckets[0];
              if (nextBucket) onBucketChange(nextBucket);
            }}
          >
            <ToolbarToggleItem
              value="expiring"
              aria-label="Expiring memberships"
            >
              <CalendarClock className="size-4" />
              <span>Expiring</span>
              {expiringCount !== null ? (
                <Badge variant="neutral" size="count">
                  {expiringCount}
                </Badge>
              ) : null}
            </ToolbarToggleItem>
            <ToolbarToggleItem value="expired" aria-label="Expired memberships">
              <CircleAlert className="size-4" />
              <span>Expired</span>
              {expiredCount !== null ? (
                <Badge variant="neutral" size="count">
                  {expiredCount}
                </Badge>
              ) : null}
            </ToolbarToggleItem>
          </ToolbarToggleGroup>
        </Toolbar>

        <Select
          key={bucket}
          value={windowValue}
          onValueChange={(value) => value && onWindowChange(value)}
        >
          <SelectTrigger
            size="sm"
            className="ml-auto w-40"
            aria-label={
              bucket === 'expiring'
                ? 'Expiring membership duration'
                : 'Expired membership duration'
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {windows.map((window) => (
              <SelectItem key={window.value} value={window.value}>
                {window.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="min-w-0">
          <TableSkeleton
            className="min-w-[900px] table-fixed"
            label="Loading renewals"
            rows={7}
            columns={[
              { label: 'Name', variant: 'identity', width: 190 },
              { label: 'Plan', width: 105 },
              { label: 'Expiry', width: 110 },
              { label: 'Status', variant: 'badge', width: 125 },
              { label: 'Fee', variant: 'stacked', width: 120 },
              {
                label: 'Actions',
                variant: 'actions',
                width: 250,
                headClassName: 'text-right',
              },
            ]}
          />
        </div>
      ) : loadError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <CircleAlert className="text-destructive size-6" />
          <p className="text-muted-foreground text-sm">
            Could not load renewals.
          </p>
          <Button size="sm" variant="outline" onClick={onChanged}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="text-emerald-foreground size-6" />
          <p className="text-muted-foreground text-sm">{emptyLabel}</p>
        </div>
      ) : (
        <div className="min-w-0">
          <Table className="min-w-[900px] table-fixed">
            <TableCaption className="sr-only">
              {bucket === 'expiring' ? 'Expiring' : 'Expired'} memberships
            </TableCaption>
            <colgroup>
              <col style={{ width: 190 }} />
              <col style={{ width: 105 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 125 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 250 }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const eff = effectiveStatus(m, today);
                const days = daysUntil(m.end_date, today);
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(m.id)}
                  >
                    <TableCell>
                      <MemberIdentity
                        name={m.contact?.name}
                        secondary={m.contact?.phone}
                        src={m.contact?.avatar_url}
                        avatarPreview={buildMemberAvatarPreview({
                          membership: m,
                          accountId,
                          view: 'renewals',
                          readiness,
                          canFollowUp,
                          onSelect: () => onSelect(m.id),
                          onFollowUp: onAssign ? () => onAssign(m) : undefined,
                          onReminderSent: onChanged,
                        })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate">
                      {m.plan?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmt.date(m.end_date)}
                    </TableCell>
                    <TableCell>
                      <MembershipStatusBadge status={eff} daysToExpiry={days} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <FeeStatusBadge status={m.fee_status} />
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {fmt.money(m.fee_amount)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {onAssign && (
                          <FollowUpButton
                            canAct={canFollowUp}
                            onClick={() => onAssign(m)}
                          />
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRenew(m)}
                        >
                          <RefreshCw className="size-3.5" /> Renew
                        </Button>
                        <SendReminderButton
                          membership={m}
                          readiness={readiness}
                          onSent={onChanged}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="border-border flex items-center border-t px-3 py-2">
            <p className="text-muted-foreground text-xs">
              Showing {rows.length} of{' '}
              {(bucket === 'expiring' ? expiringCount : expiredCount) ??
                rows.length}{' '}
              {bucket === 'expiring' ? 'expiring' : 'expired'} memberships
            </p>
            {hasMore ? (
              <Button
                className="ml-auto"
                size="sm"
                variant="ghost"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Load more
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
