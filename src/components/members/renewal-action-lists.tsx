'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleAlert,
  CheckCircle2,
  ListPlus,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import {
  istAddDays,
  daysUntil,
  effectiveStatus,
} from '@/lib/memberships/expiry';
import { isRenewalChaseable } from '@/lib/memberships/pricing';
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
import {
  SendReminderButton,
  type ReminderReadiness,
} from './send-reminder-button';
import { FollowUpDialog } from './follow-up-dialog';
import { RenewMembershipDialog } from './renew-membership-dialog';

interface RenewalActionListsProps {
  readiness: ReminderReadiness;
  onSelect: (membershipId: string) => void;
  reloadKey: number;
}

const SELECT = '*, contact:contacts(*), plan:membership_plans(*)';

type RenewalBucket = 'expiring' | 'expired';

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
const MAX_EXPIRING_DAYS = Math.max(
  ...EXPIRING_WINDOWS.flatMap((window) =>
    window.days === null ? [] : [window.days]
  )
);

export function RenewalActionLists({
  readiness,
  onSelect,
  reloadKey,
}: RenewalActionListsProps) {
  const { canSendMessages } = useAuth();
  const { fmt } = useLocale();

  const [expiring, setExpiring] = useState<Membership[]>([]);
  const [expired, setExpired] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const today = fmt.today();
      const expiringThrough = istAddDays(today, MAX_EXPIRING_DAYS);

      const [expiringRes, expiredRes] = await Promise.all([
        supabase
          .from('memberships')
          .select(SELECT)
          .eq('is_trial', false)
          .eq('status', 'active')
          .gte('end_date', today)
          .lte('end_date', expiringThrough)
          .order('end_date', { ascending: true }),
        supabase
          .from('memberships')
          .select(SELECT)
          .eq('is_trial', false)
          .eq('status', 'active')
          .lt('end_date', today)
          // Most-recently lapsed first — the freshest chase targets.
          .order('end_date', { ascending: false }),
      ]);
      if (cancelled) return;

      // Only RECURRING plans belong in the renewal chase (062).
      const isChaseable = (m: Membership) => isRenewalChaseable(m.plan);
      setExpiring(
        ((expiringRes.data as Membership[]) ?? []).filter(isChaseable)
      );
      setExpired(((expiredRes.data as Membership[]) ?? []).filter(isChaseable));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce, fmt]);

  const today = fmt.today();

  const expiringFiltered = useMemo(() => {
    const window = EXPIRING_WINDOWS.find(
      (item) => item.value === expiringWindow
    );
    if (!window?.days) return expiring;
    const cutoff = istAddDays(today, window.days);
    return expiring.filter((membership) => membership.end_date <= cutoff);
  }, [expiring, expiringWindow, today]);

  const expiredFiltered = useMemo(() => {
    const window = EXPIRED_WINDOWS.find((item) => item.value === expiredWindow);
    if (!window?.days) return expired;
    const cutoff = istAddDays(today, -window.days);
    // ISO date strings compare lexically = chronologically.
    return expired.filter((membership) => membership.end_date >= cutoff);
  }, [expired, expiredWindow, today]);

  const activeRows = bucket === 'expiring' ? expiringFiltered : expiredFiltered;
  const activeWindows =
    bucket === 'expiring' ? EXPIRING_WINDOWS : EXPIRED_WINDOWS;
  const activeWindow = bucket === 'expiring' ? expiringWindow : expiredWindow;
  const emptyLabel =
    bucket === 'expiring'
      ? 'No memberships expiring in this window.'
      : 'No expired memberships in this window.';

  return (
    <>
      <RenewalTable
        bucket={bucket}
        onBucketChange={setBucket}
        rows={activeRows}
        expiringCount={expiringFiltered.length}
        expiredCount={expiredFiltered.length}
        windows={activeWindows}
        windowValue={activeWindow}
        onWindowChange={(value) => {
          if (bucket === 'expiring') setExpiringWindow(value);
          else setExpiredWindow(value);
        }}
        loading={loading}
        readiness={readiness}
        onSelect={onSelect}
        onChanged={reload}
        onAssign={canSendMessages ? setAssigning : undefined}
        onRenew={setRenewing}
        emptyLabel={emptyLabel}
      />

      {assigning && (
        <FollowUpDialog
          open={!!assigning}
          onOpenChange={(o) => {
            if (!o) setAssigning(null);
          }}
          membership={assigning}
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
  bucket,
  onBucketChange,
  rows,
  expiringCount,
  expiredCount,
  windows,
  windowValue,
  onWindowChange,
  loading,
  readiness,
  onSelect,
  onChanged,
  onAssign,
  onRenew,
  emptyLabel,
}: {
  bucket: RenewalBucket;
  onBucketChange: (bucket: RenewalBucket) => void;
  rows: Membership[];
  expiringCount: number;
  expiredCount: number;
  windows: RenewalWindow[];
  windowValue: string;
  onWindowChange: (value: string) => void;
  loading: boolean;
  readiness: ReminderReadiness;
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
              <Badge
                variant="neutral"
                className="h-auto rounded px-1.5 py-0 text-xs tabular-nums"
              >
                {expiringCount}
              </Badge>
            </ToolbarToggleItem>
            <ToolbarToggleItem value="expired" aria-label="Expired memberships">
              <CircleAlert className="size-4" />
              <span>Expired</span>
              <Badge
                variant="neutral"
                className="h-auto rounded px-1.5 py-0 text-xs tabular-nums"
              >
                {expiredCount}
              </Badge>
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
        <div className="text-muted-foreground flex items-center gap-2 px-3 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading renewals…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="size-6 text-emerald-700 dark:text-emerald-500/70" />
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
                <TableHead className="text-muted-foreground">Name</TableHead>
                <TableHead className="text-muted-foreground">Plan</TableHead>
                <TableHead className="text-muted-foreground">Expiry</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Fee</TableHead>
                <TableHead className="text-muted-foreground text-right">
                  Actions
                </TableHead>
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
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onAssign(m)}
                          >
                            <ListPlus className="size-3.5" /> Follow up
                          </Button>
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
              {rows.length} {bucket === 'expiring' ? 'expiring' : 'expired'}{' '}
              membership{rows.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
