'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Loader2,
  LogOut,
  UserCheck,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { dayStartInTz } from '@/lib/locale/format';
import { fetchCheckInUsage } from '@/lib/memberships/check-in';
import {
  loadAttendanceSnapshot,
  type AttendanceBucket,
  type AttendanceSnapshotRow,
  type AttendanceSort,
} from '@/lib/memberships/attendance-snapshot';
import {
  usageSummary,
  type CheckInWarning,
} from '@/lib/memberships/attendance-limits';
import { istAddDays } from '@/lib/memberships/expiry';
import { createClient } from '@/lib/supabase/client';
import type { Attendance, AttendanceMethod, Membership } from '@/types';
import { ColumnHeader } from '@/components/table/column-header';
import { TableSkeletonRows } from '@/components/table/table-skeleton';
import { AttendanceOverrideDialog } from './attendance-override-dialog';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import { MemberIdentity } from './member-identity';
import { buildMemberAvatarPreview } from './member-avatar-quick-view';
import type { ReminderReadiness } from './send-reminder-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import {
  Table,
  TableBody,
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

const PAGE_SIZE = 25;

interface AttendanceViewProps {
  readiness: ReminderReadiness;
  /** Bump to refetch after a mutation elsewhere. */
  reloadKey: number;
  /** Opens the member detail sheet (keyed by membership id). */
  onSelect: (membershipId: string) => void;
  /** Notify the parent that attendance changed so every member list refreshes. */
  onAttendanceChanged?: () => void;
}

export function AttendanceView({
  readiness,
  reloadKey,
  onSelect,
  onAttendanceChanged,
}: AttendanceViewProps) {
  const { user, accountId, canSendMessages } = useAuth();
  const { locale, fmt } = useLocale();
  const today = fmt.today();

  const [dayOffset, setDayOffset] = useState(0);
  const selectedDate = istAddDays(today, dayOffset);
  const isToday = dayOffset === 0;

  const [rows, setRows] = useState<AttendanceSnapshotRow[]>([]);
  const [bucket, setBucket] = useState<AttendanceBucket>('absent');
  const [search, setSearch] = useState('');
  const [planFilters, setPlanFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<AttendanceSort>({
    key: 'name',
    dir: 'asc',
  });
  const [page, setPage] = useState(0);
  const [loadedPage, setLoadedPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [absentCount, setAbsentCount] = useState(0);
  const [planFilterOptions, setPlanFilterOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [followUpFor, setFollowUpFor] = useState<Membership | null>(null);
  const [override, setOverride] = useState<{
    membership: Membership;
    warning: CheckInWarning;
    method: AttendanceMethod;
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;

    const supabase = createClient();
    const controller = new AbortController();

    void (async () => {
      setLoading(true);
      setLoadError(null);

      const start = dayStartInTz(selectedDate, locale.timeZone);
      const end = dayStartInTz(istAddDays(selectedDate, 1), locale.timeZone);
      if (!start || !end) {
        setLoadError('This attendance date could not be loaded.');
        setLoading(false);
        return;
      }

      try {
        const result = await loadAttendanceSnapshot(
          supabase,
          {
            dayStart: start.toISOString(),
            dayEnd: end.toISOString(),
            today,
            timeZone: locale.timeZone,
            weekStart: locale.weekStart,
            includeUsage: isToday,
            bucket,
            search,
            planIds: planFilters,
            sort,
            page,
            pageSize: PAGE_SIZE,
          },
          controller.signal
        );
        if (controller.signal.aborted) return;
        setRows(result.rows);
        setLoadedPage(result.page);
        setTotalCount(result.totalCount);
        setPresentCount(result.presentCount);
        setAbsentCount(result.absentCount);
        setPlanFilterOptions(
          [...result.planOptions].sort((a, b) =>
            a.label.localeCompare(b.label, locale.locale)
          )
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(getErrorMessage(error, 'Attendance could not be loaded'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    accountId,
    bucket,
    isToday,
    locale.locale,
    locale.timeZone,
    locale.weekStart,
    page,
    planFilters,
    reloadKey,
    search,
    selectedDate,
    sort,
    today,
  ]);

  function togglePlanFilter(planId: string) {
    setPage(0);
    setPlanFilters((current) =>
      current.includes(planId)
        ? current.filter((id) => id !== planId)
        : [...current, planId]
    );
  }

  /** The plan name + current usage shown in the dedicated Plan column. */
  function rowPlan(row: AttendanceSnapshotRow): {
    name: string;
    usage: string | null;
    danger: boolean;
  } {
    const { membership } = row;
    const planName = membership.plan?.name ?? '—';
    if (!isToday || !membership.plan) {
      return { name: planName, usage: null, danger: false };
    }
    const summary = usageSummary(membership.plan, row.used);
    return summary
      ? { name: planName, usage: summary.label, danger: summary.danger }
      : { name: planName, usage: null, danger: false };
  }

  async function doInsert(
    membership: Membership,
    method: AttendanceMethod = 'manual'
  ) {
    if (!user) return;
    setBusyId(membership.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('attendance')
        .insert({
          account_id: membership.account_id,
          contact_id: membership.contact_id,
          membership_id: membership.id,
          user_id: user.id,
          method,
        })
        .select('*')
        .single();
      if (error) throw error;

      const record = data as Attendance;
      setRows((current) =>
        current.flatMap((row) => {
          if (row.membership.id !== membership.id) return [row];
          if (bucket === 'absent') return [];
          return [{ ...row, attendance: record, used: row.used + 1 }];
        })
      );
      setPresentCount((count) => count + 1);
      setAbsentCount((count) => Math.max(0, count - 1));
      if (bucket === 'absent') {
        setTotalCount((count) => Math.max(0, count - 1));
      }
      setOverride(null);
      toast.success(`${membership.contact?.name || 'Member'} checked in`);
      onAttendanceChanged?.();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Check-in failed'));
    } finally {
      setBusyId(null);
    }
  }

  async function checkIn(
    membership: Membership,
    method: AttendanceMethod = 'manual'
  ) {
    if (!user || !isToday) return;
    setBusyId(membership.id);
    const result = await fetchCheckInUsage(
      createClient(),
      membership,
      today,
      locale
    );
    if (result) {
      setRows((current) =>
        current.map((row) =>
          row.membership.id === membership.id
            ? { ...row, used: result.used }
            : row
        )
      );
      if (result.warning) {
        setBusyId(null);
        setOverride({ membership, warning: result.warning, method });
        return;
      }
    }
    await doInsert(membership, method);
  }

  async function checkOut(membership: Membership, attendance: Attendance) {
    if (!isToday) return;
    setBusyId(membership.id);
    const checkedOutAt = new Date().toISOString();
    try {
      const { data, error } = await createClient()
        .from('attendance')
        .update({ checked_out_at: checkedOutAt })
        .eq('id', attendance.id)
        .is('checked_out_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This visit was already checked out.');

      setRows((current) =>
        current.map((row) =>
          row.membership.id === membership.id
            ? {
                ...row,
                attendance: { ...attendance, checked_out_at: checkedOutAt },
              }
            : row
        )
      );
      toast.success(`${membership.contact?.name || 'Member'} checked out`);
      onAttendanceChanged?.();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Check-out failed'));
    } finally {
      setBusyId(null);
    }
  }

  function emptyMessage() {
    if (presentCount + absentCount === 0) return 'No members yet.';
    if (search.trim()) {
      return `No ${bucket} members match your search.`;
    }
    if (bucket === 'present') {
      return `No members checked in on ${fmt.date(selectedDate)}.`;
    }
    return `Everyone was present on ${fmt.date(selectedDate)}.`;
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasPreviousPage = loadedPage > 0;
  const hasNextPage = loadedPage < totalPages - 1;
  const firstShown = totalCount === 0 ? 0 : loadedPage * PAGE_SIZE + 1;
  const lastShown = Math.min((loadedPage + 1) * PAGE_SIZE, totalCount);

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <SearchInput
            value={search}
            onValueChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            placeholder="Search by name or ID"
            aria-label="Search attendance by name or Member ID"
          />

          <Toolbar aria-label="Attendance status">
            <ToolbarToggleGroup<AttendanceBucket>
              aria-label="Attendance status"
              value={[bucket]}
              onValueChange={(nextBuckets) => {
                const nextBucket = nextBuckets[0];
                if (nextBucket) {
                  setBucket(nextBucket);
                  setPage(0);
                }
              }}
            >
              <ToolbarToggleItem value="present" aria-label="Present members">
                <UserCheck className="size-4" />
                <span>Present</span>
                <Badge variant="neutral" size="count">
                  {presentCount}
                </Badge>
              </ToolbarToggleItem>
              <ToolbarToggleItem value="absent" aria-label="Absent members">
                <UserX className="size-4" />
                <span>Absent</span>
                <Badge variant="neutral" size="count">
                  {absentCount}
                </Badge>
              </ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>

          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDayOffset(0);
                setPage(0);
              }}
              aria-current={isToday ? 'date' : undefined}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setDayOffset((offset) => offset - 1);
                setPage(0);
              }}
              aria-label="Previous day"
              title="Previous day"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isToday}
              onClick={() => {
                setDayOffset((offset) => Math.min(0, offset + 1));
                setPage(0);
              }}
              aria-label="Next day"
              title={isToday ? 'Today is the latest date' : 'Next day'}
            >
              <ChevronRight className="size-4" />
            </Button>
            <span className="text-foreground min-w-0 truncate px-1 text-sm font-medium tabular-nums">
              {fmt.date(selectedDate)}
            </span>
          </div>
        </div>

        <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%] px-4">
                <ColumnHeader
                  label="Name"
                  sortable
                  sortDir={sort.key === 'name' ? sort.dir : null}
                  onSort={(dir) => {
                    setSort({ key: 'name', dir });
                    setPage(0);
                  }}
                />
              </TableHead>
              <TableHead className="w-[20%]">
                <ColumnHeader
                  label="Plan"
                  sortable={false}
                  sortDir={null}
                  onSort={() => undefined}
                  filter={{
                    options: planFilterOptions,
                    selected: planFilters,
                    onToggle: togglePlanFilter,
                  }}
                />
              </TableHead>
              <TableHead className="w-[15%]">
                <ColumnHeader
                  label="Check-in"
                  sortable
                  sortDir={sort.key === 'checked_in_at' ? sort.dir : null}
                  onSort={(dir) => {
                    setSort({ key: 'checked_in_at', dir });
                    setPage(0);
                  }}
                />
              </TableHead>
              <TableHead className="w-[15%]">
                <ColumnHeader
                  label="Check-out"
                  sortable
                  sortDir={sort.key === 'checked_out_at' ? sort.dir : null}
                  onSort={(dir) => {
                    setSort({ key: 'checked_out_at', dir });
                    setPage(0);
                  }}
                />
              </TableHead>
              <TableHead className="w-[20%] pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeletonRows
                label="Loading attendance"
                rows={7}
                columns={[
                  { variant: 'identity' },
                  { variant: 'text' },
                  { variant: 'text' },
                  { variant: 'text' },
                  { variant: 'actions' },
                ]}
              />
            ) : loadError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 px-4 text-center">
                  <span className="text-destructive text-sm">{loadError}</span>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-40 px-4 text-center">
                  <span className="text-muted-foreground inline-flex flex-col items-center gap-2 text-sm">
                    <Dumbbell className="size-7" />
                    {emptyMessage()}
                  </span>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const { membership, attendance } = row;
                const plan = rowPlan(row);
                const busy = busyId === membership.id;
                return (
                  <TableRow
                    key={membership.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(membership.id)}
                  >
                    <TableCell className="px-4 py-2.5">
                      <MemberIdentity
                        name={membership.contact?.name}
                        secondary={membership.contact?.phone}
                        src={membership.contact?.avatar_url}
                        avatarPreview={buildMemberAvatarPreview({
                          membership,
                          accountId,
                          view: 'attendance',
                          readiness,
                          canFollowUp: canSendMessages,
                          onSelect: () => onSelect(membership.id),
                          onFollowUp: () => setFollowUpFor(membership),
                          onReminderSent: onAttendanceChanged,
                        })}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground block truncate">
                        {plan.name}
                      </span>
                      {plan.usage && (
                        <span
                          className={
                            plan.danger
                              ? 'text-red-foreground block truncate text-xs'
                              : 'text-muted-foreground block truncate text-xs'
                          }
                        >
                          {plan.usage}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {attendance ? fmt.time(attendance.checked_in_at) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {attendance?.checked_out_at
                        ? fmt.time(attendance.checked_out_at)
                        : '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <div
                        className="flex justify-end"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {!isToday ? (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        ) : attendance?.checked_out_at ? (
                          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                            <Check className="size-3.5" /> Complete
                          </span>
                        ) : attendance ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!canSendMessages || busy}
                            title={
                              canSendMessages
                                ? 'Check member out'
                                : "Read-only — your role can't change attendance"
                            }
                            onClick={() =>
                              void checkOut(membership, attendance)
                            }
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <LogOut className="size-3.5" />
                            )}
                            Check out
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!canSendMessages || busy}
                            title={
                              canSendMessages
                                ? 'Check member in'
                                : "Read-only — your role can't change attendance"
                            }
                            onClick={() => void checkIn(membership)}
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <UserCheck className="size-3.5" />
                            )}
                            Check in
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <div className="border-border flex items-center justify-between border-t px-3 py-2">
          <p className="text-muted-foreground text-xs">
            {totalCount > 0
              ? `Showing ${firstShown}–${lastShown} of ${totalCount} ${bucket} members`
              : `No ${bucket} members`}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={!hasPreviousPage}
              onClick={() => setPage(loadedPage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground px-2 text-xs">
              Page {loadedPage + 1} of {Math.max(totalPages, 1)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={!hasNextPage}
              onClick={() => setPage(loadedPage + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      <AttendanceOverrideDialog
        open={!!override}
        warning={override?.warning ?? null}
        busy={!!override && busyId === override.membership.id}
        onConfirm={() =>
          override && void doInsert(override.membership, override.method)
        }
        onCancel={() => setOverride(null)}
      />

      {followUpFor && (
        <FollowUpDialog
          open
          onOpenChange={(open) => !open && setFollowUpFor(null)}
          membership={followUpFor}
          onSaved={() => {
            setFollowUpFor(null);
            onAttendanceChanged?.();
          }}
        />
      )}
    </>
  );
}
