'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Hash,
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
import { parseMemberNumber } from '@/lib/memberships/member-number';
import { createClient } from '@/lib/supabase/client';
import type { Attendance, AttendanceMethod, Membership } from '@/types';
import { ColumnHeader, type SortDir } from '@/components/table/column-header';
import { AttendanceOverrideDialog } from './attendance-override-dialog';
import { MemberIdentity } from './member-identity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [memberIdInput, setMemberIdInput] = useState('');
  const [planFilters, setPlanFilters] = useState<string[]>([]);
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
    method: AttendanceMethod;
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

  const planFilterOptions = useMemo(() => {
    const options = new Map<string, string>();
    rows.forEach((membership) => {
      if (membership.plan_id && membership.plan) {
        options.set(membership.plan_id, membership.plan.name);
      }
    });
    return Array.from(options, ([value, label]) => ({ value, label })).sort(
      (a, b) => a.label.localeCompare(b.label, locale.locale)
    );
  }, [locale.locale, rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale.locale);
    return sortedRows.filter((membership) => {
      const isPresent = attendanceByContact.has(membership.contact_id);
      if ((bucket === 'present') !== isPresent) return false;
      if (
        planFilters.length > 0 &&
        (!membership.plan_id || !planFilters.includes(membership.plan_id))
      ) {
        return false;
      }
      if (!query) return true;
      const name =
        membership.contact?.name?.toLocaleLowerCase(locale.locale) ?? '';
      const phone = membership.contact?.phone ?? '';
      return name.includes(query) || phone.includes(query);
    });
  }, [
    attendanceByContact,
    bucket,
    locale.locale,
    planFilters,
    search,
    sortedRows,
  ]);

  function togglePlanFilter(planId: string) {
    setPlanFilters((current) =>
      current.includes(planId)
        ? current.filter((id) => id !== planId)
        : [...current, planId]
    );
  }

  /** The plan name + current usage shown in the dedicated Plan column. */
  function rowPlan(membership: Membership): {
    name: string;
    usage: string | null;
    danger: boolean;
  } {
    const planName = membership.plan?.name ?? '—';
    if (!isToday || !membership.plan) {
      return { name: planName, usage: null, danger: false };
    }
    const summary = usageSummary(
      membership.plan,
      usage.get(membership.id) ?? 0
    );
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
      setUsage((previous) => new Map(previous).set(membership.id, result.used));
      if (result.warning) {
        setBusyId(null);
        setOverride({ membership, warning: result.warning, method });
        return;
      }
    }
    await doInsert(membership, method);
  }

  function handleMemberIdCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !canSendMessages || !isToday || busyId) return;

    const memberNumber = parseMemberNumber(memberIdInput);
    if (memberNumber === null) {
      toast.error('Enter a valid Member ID');
      return;
    }

    const membership = rows.find((row) => row.member_number === memberNumber);
    if (!membership) {
      toast.error(`No member found with ID ${memberNumber}`);
      return;
    }

    const attendance = attendanceByContact.get(membership.contact_id);
    if (attendance) {
      setBucket('present');
      setMemberIdInput('');
      toast.info(
        attendance.checked_out_at
          ? `${membership.contact?.name || 'Member'} already completed attendance today`
          : `${membership.contact?.name || 'Member'} is already checked in`
      );
      return;
    }

    setMemberIdInput('');
    void checkIn(membership, 'member_id');
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

          <form
            className="flex shrink-0 items-center gap-1"
            onSubmit={handleMemberIdCheckIn}
          >
            <Input
              value={memberIdInput}
              onChange={(event) => setMemberIdInput(event.target.value)}
              className="w-28"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="Member ID"
              aria-label="Member ID for quick check-in"
              disabled={!canSendMessages || !isToday || loading}
              title={
                !canSendMessages
                  ? "Read-only — your role can't change attendance"
                  : !isToday
                    ? 'Quick check-in is available only for today'
                    : 'Enter a Member ID'
              }
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={
                !canSendMessages ||
                !isToday ||
                loading ||
                !!busyId ||
                !memberIdInput.trim()
              }
              title={
                isToday
                  ? 'Check in by Member ID'
                  : 'Quick check-in is available only for today'
              }
            >
              <Hash className="size-3.5" />
              Check in
            </Button>
          </form>

          <SearchInput
            containerClassName="ml-auto"
            value={search}
            onValueChange={setSearch}
            placeholder="Search members…"
            aria-label="Search attendance members"
          />
        </div>

        <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%] px-4">
                <ColumnHeader
                  label="Name"
                  sortable
                  sortDir={sort.key === 'name' ? sort.dir : null}
                  onSort={(dir) => setSort({ key: 'name', dir })}
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
                  onSort={(dir) => setSort({ key: 'checked_in_at', dir })}
                />
              </TableHead>
              <TableHead className="w-[15%]">
                <ColumnHeader
                  label="Check-out"
                  sortable
                  sortDir={sort.key === 'checked_out_at' ? sort.dir : null}
                  onSort={(dir) => setSort({ key: 'checked_out_at', dir })}
                />
              </TableHead>
              <TableHead className="w-[20%] pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 px-4 text-center">
                  <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" /> Loading
                    attendance…
                  </span>
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-32 px-4 text-center">
                  <span className="text-destructive text-sm">{loadError}</span>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-40 px-4 text-center">
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
                const plan = rowPlan(membership);
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
    </>
  );
}
