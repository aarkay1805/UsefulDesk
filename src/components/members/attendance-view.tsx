'use client';

import { useEffect, useMemo, useState } from 'react';
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
import {
  fetchCheckInUsage,
  fetchUsageCounts,
} from '@/lib/memberships/check-in';
import {
  usageSummary,
  type CheckInWarning,
} from '@/lib/memberships/attendance-limits';
import { istAddDays } from '@/lib/memberships/expiry';
import { createClient } from '@/lib/supabase/client';
import type { Attendance, Membership } from '@/types';
import { ColumnHeader, type SortDir } from '@/components/table/column-header';
import { AttendanceOverrideDialog } from './attendance-override-dialog';
import { MemberIdentity } from './member-identity';
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

type AttendanceBucket = 'present' | 'absent';
type AttendanceSortKey = 'name' | 'checked_in_at' | 'checked_out_at';

interface AttendanceSort {
  key: AttendanceSortKey;
  dir: SortDir;
}

interface AttendanceViewProps {
  /** Bump to refetch after a mutation elsewhere. */
  reloadKey: number;
  /** Opens the member detail sheet (keyed by membership id). */
  onSelect: (membershipId: string) => void;
  /** Notify the parent that attendance changed so every member list refreshes. */
  onAttendanceChanged?: () => void;
}

export function AttendanceView({
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

  const [rows, setRows] = useState<Membership[]>([]);
  const [attendanceByContact, setAttendanceByContact] = useState<
    Map<string, Attendance>
  >(new Map());
  /** membership_id → visits inside its plan's usage window (062). */
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [bucket, setBucket] = useState<AttendanceBucket>('absent');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AttendanceSort>({
    key: 'name',
    dir: 'asc',
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [override, setOverride] = useState<{
    membership: Membership;
    warning: CheckInWarning;
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;

    const supabase = createClient();
    let cancelled = false;

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

      const [membersRes, attendanceRes] = await Promise.all([
        supabase
          .from('memberships')
          .select('*, contact:contacts!inner(*), plan:membership_plans(*)')
          .eq('account_id', accountId),
        supabase
          .from('attendance')
          .select('*')
          .eq('account_id', accountId)
          .gte('checked_in_at', start.toISOString())
          .lt('checked_in_at', end.toISOString())
          .order('checked_in_at', { ascending: false }),
      ]);

      if (cancelled) return;
      if (membersRes.error || attendanceRes.error) {
        const message = getErrorMessage(
          membersRes.error ?? attendanceRes.error,
          'Attendance could not be loaded'
        );
        setLoadError(message);
        setLoading(false);
        return;
      }

      const members = (membersRes.data as Membership[] | null) ?? [];
      const records = (attendanceRes.data as Attendance[] | null) ?? [];
      const nextAttendance = new Map<string, Attendance>();
      // Rows arrive newest-first. Keep one visit per member for the daily
      // register; the latest record retains its matching checkout time.
      records.forEach((record) => {
        if (!nextAttendance.has(record.contact_id)) {
          nextAttendance.set(record.contact_id, record);
        }
      });

      setRows(members);
      setAttendanceByContact(nextAttendance);

      if (isToday) {
        const counts = await fetchUsageCounts(supabase, members, today, locale);
        if (cancelled) return;
        setUsage(counts);
      } else {
        setUsage(new Map());
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, isToday, locale, reloadKey, selectedDate, today]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const nameComparison = (a.contact?.name ?? '').localeCompare(
        b.contact?.name ?? '',
        locale.locale
      );

      if (sort.key === 'name') {
        return nameComparison * (sort.dir === 'asc' ? 1 : -1);
      }

      const attendanceA = attendanceByContact.get(a.contact_id);
      const attendanceB = attendanceByContact.get(b.contact_id);
      const timeA = attendanceA?.[sort.key] ?? null;
      const timeB = attendanceB?.[sort.key] ?? null;

      // Keep members without a recorded time at the end in both directions.
      // This leaves active (not-yet-checked-out) visits easy to find.
      if (!timeA && !timeB) return nameComparison;
      if (!timeA) return 1;
      if (!timeB) return -1;

      const timeComparison = timeA.localeCompare(timeB);
      return timeComparison === 0
        ? nameComparison
        : timeComparison * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [attendanceByContact, locale.locale, rows, sort]);

  const presentCount = useMemo(
    () =>
      rows.filter((membership) =>
        attendanceByContact.has(membership.contact_id)
      ).length,
    [attendanceByContact, rows]
  );
  const absentCount = Math.max(0, rows.length - presentCount);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale.locale);
    return sortedRows.filter((membership) => {
      const isPresent = attendanceByContact.has(membership.contact_id);
      if ((bucket === 'present') !== isPresent) return false;
      if (!query) return true;
      const name =
        membership.contact?.name?.toLocaleLowerCase(locale.locale) ?? '';
      const phone = membership.contact?.phone ?? '';
      return name.includes(query) || phone.includes(query);
    });
  }, [attendanceByContact, bucket, locale.locale, search, sortedRows]);

  /** The plan-name + current usage line under a member's identity. */
  function rowMeta(membership: Membership): { text: string; danger: boolean } {
    const planName = membership.plan?.name ?? '—';
    if (!isToday || !membership.plan) return { text: planName, danger: false };
    const summary = usageSummary(
      membership.plan,
      usage.get(membership.id) ?? 0
    );
    return summary
      ? { text: `${planName} · ${summary.label}`, danger: summary.danger }
      : { text: planName, danger: false };
  }

  async function doInsert(membership: Membership) {
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
          method: 'manual',
        })
        .select('*')
        .single();
      if (error) throw error;

      const record = data as Attendance;
      setAttendanceByContact((previous) =>
        new Map(previous).set(membership.contact_id, record)
      );
      setUsage((previous) =>
        new Map(previous).set(
          membership.id,
          (previous.get(membership.id) ?? 0) + 1
        )
      );
      setOverride(null);
      toast.success(`${membership.contact?.name || 'Member'} checked in`);
      onAttendanceChanged?.();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Check-in failed'));
    } finally {
      setBusyId(null);
    }
  }

  async function checkIn(membership: Membership) {
    if (!user || !isToday) return;
    setBusyId(membership.id);
    const result = await fetchCheckInUsage(
      createClient(),
      membership,
      today,
      locale
    );
    if (result) {
      setUsage((previous) => new Map(previous).set(membership.id, result.used));
      if (result.warning) {
        setBusyId(null);
        setOverride({ membership, warning: result.warning });
        return;
      }
    }
    await doInsert(membership);
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

      setAttendanceByContact((previous) =>
        new Map(previous).set(membership.contact_id, {
          ...attendance,
          checked_out_at: checkedOutAt,
        })
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
    if (rows.length === 0) return 'No members yet.';
    if (search.trim()) {
      return `No ${bucket} members match your search.`;
    }
    if (bucket === 'present') {
      return `No members checked in on ${fmt.date(selectedDate)}.`;
    }
    return `Everyone was present on ${fmt.date(selectedDate)}.`;
  }

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          <Toolbar aria-label="Attendance status">
            <ToolbarToggleGroup<AttendanceBucket>
              aria-label="Attendance status"
              value={[bucket]}
              onValueChange={(nextBuckets) => {
                const nextBucket = nextBuckets[0];
                if (nextBucket) setBucket(nextBucket);
              }}
            >
              <ToolbarToggleItem value="present" aria-label="Present members">
                <UserCheck className="size-4" />
                <span>Present</span>
                <Badge variant="neutral">
                  <span className="tabular-nums">{presentCount}</span>
                </Badge>
              </ToolbarToggleItem>
              <ToolbarToggleItem value="absent" aria-label="Absent members">
                <UserX className="size-4" />
                <span>Absent</span>
                <Badge variant="neutral">
                  <span className="tabular-nums">{absentCount}</span>
                </Badge>
              </ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>

          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDayOffset(0)}
              aria-current={isToday ? 'date' : undefined}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDayOffset((offset) => offset - 1)}
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
              onClick={() => setDayOffset((offset) => Math.min(0, offset + 1))}
              aria-label="Next day"
              title={isToday ? 'Today is the latest date' : 'Next day'}
            >
              <ChevronRight className="size-4" />
            </Button>
            <span className="text-foreground min-w-0 truncate px-1 text-sm font-medium tabular-nums">
              {fmt.date(selectedDate)}
            </span>
          </div>

          <SearchInput
            containerClassName="ml-auto min-w-52 flex-1 basis-56 sm:max-w-xs"
            value={search}
            onValueChange={setSearch}
            placeholder="Search members…"
            aria-label="Search attendance members"
          />
        </div>

        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[46%] px-4">
                <ColumnHeader
                  label="Name"
                  sortable
                  sortDir={sort.key === 'name' ? sort.dir : null}
                  onSort={(dir) => setSort({ key: 'name', dir })}
                />
              </TableHead>
              <TableHead className="w-[18%]">
                <ColumnHeader
                  label="Check-in"
                  sortable
                  sortDir={sort.key === 'checked_in_at' ? sort.dir : null}
                  onSort={(dir) => setSort({ key: 'checked_in_at', dir })}
                />
              </TableHead>
              <TableHead className="w-[18%]">
                <ColumnHeader
                  label="Check-out"
                  sortable
                  sortDir={sort.key === 'checked_out_at' ? sort.dir : null}
                  onSort={(dir) => setSort({ key: 'checked_out_at', dir })}
                />
              </TableHead>
              <TableHead className="w-[18%] pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="h-32 px-4 text-center">
                  <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" /> Loading
                    attendance…
                  </span>
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="h-32 px-4 text-center">
                  <span className="text-destructive text-sm">{loadError}</span>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="h-40 px-4 text-center">
                  <span className="text-muted-foreground inline-flex flex-col items-center gap-2 text-sm">
                    <Dumbbell className="size-7" />
                    {emptyMessage()}
                  </span>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((membership) => {
                const attendance = attendanceByContact.get(
                  membership.contact_id
                );
                const meta = rowMeta(membership);
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
                        meta={
                          <p
                            className={
                              meta.danger
                                ? 'truncate text-xs text-red-foreground'
                                : 'text-muted-foreground truncate text-xs'
                            }
                          >
                            {meta.text}
                          </p>
                        }
                      />
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
      </section>

      <AttendanceOverrideDialog
        open={!!override}
        warning={override?.warning ?? null}
        busy={!!override && busyId === override.membership.id}
        onConfirm={() => override && void doInsert(override.membership)}
        onCancel={() => setOverride(null)}
      />
    </>
  );
}
