/**
 * Attendance-limit + session-pack math (migration 062) — pure, tested.
 *
 * Limits are a WARN-with-override at check-in, never a hard block: the
 * front desk sees "12/12 this month" and can still check the member in.
 * All window math is date-only ('YYYY-MM-DD'); the caller converts a
 * window start to an instant with `dayStartInTz` for the attendance query.
 */

import { istAddDays } from "@/lib/memberships/expiry";
import type { AttendanceLimitInterval, MembershipPlan } from "@/types";

/**
 * The first day ('YYYY-MM-DD', inclusive) of the window visits count
 * over. 'period' = the membership's current billing cycle; 'week' = the
 * most recent `weekStart` day (account locale: 0 Sun | 1 Mon | 6 Sat) on
 * or before today; 'month' = the 1st of today's calendar month.
 */
export function attendanceWindowStart(
  interval: AttendanceLimitInterval,
  opts: { periodStart: string; today: string; weekStart: number },
): string {
  if (interval === "period") return opts.periodStart;
  if (interval === "month") return `${opts.today.slice(0, 8)}01`;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.today);
  if (!m) return opts.today;
  const dow = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).getUTCDay();
  const back = (dow - opts.weekStart + 7) % 7;
  return istAddDays(opts.today, -back);
}

export interface AttendanceUsage {
  /** Null = unlimited (no limit configured, or not a limited plan type). */
  limit: number | null;
  used: number;
  /** used >= limit (only ever true with a real limit). */
  exceeded: boolean;
  /** "9/12 this period" — null when unlimited. */
  label: string | null;
}

const INTERVAL_LABEL: Record<AttendanceLimitInterval, string> = {
  period: "this period",
  week: "this week",
  month: "this month",
};

/** Usage vs a recurring/non_recurring plan's attendance limit. */
export function attendanceUsage(
  plan: Pick<
    MembershipPlan,
    "plan_type" | "attendance_limit_count" | "attendance_limit_interval"
  >,
  used: number,
): AttendanceUsage {
  const limit =
    plan.plan_type !== "session_pack" &&
    plan.attendance_limit_count &&
    plan.attendance_limit_interval
      ? plan.attendance_limit_count
      : null;
  if (!limit) return { limit: null, used, exceeded: false, label: null };
  return {
    limit,
    used,
    exceeded: used >= limit,
    label: `${used}/${limit} ${INTERVAL_LABEL[plan.attendance_limit_interval!]}`,
  };
}

/** Sessions left in a pack — derived, clamped at 0. */
export function sessionsRemaining(
  sessionsCount: number,
  usedSinceStart: number,
): number {
  return Math.max(sessionsCount - usedSinceStart, 0);
}

/**
 * The first day visits count over for a MEMBERSHIP, or null when nothing
 * is tracked (unlimited plan / no plan). Session packs count from the
 * current cycle start; limited plans per their configured interval.
 */
export function membershipUsageWindowStart(
  m: {
    start_date: string;
    plan?: Pick<
      MembershipPlan,
      | "plan_type"
      | "attendance_limit_count"
      | "attendance_limit_interval"
      | "sessions_count"
    > | null;
  },
  today: string,
  weekStart: number,
): string | null {
  const plan = m.plan;
  if (!plan) return null;
  if (plan.plan_type === "session_pack") {
    return plan.sessions_count ? m.start_date : null;
  }
  if (plan.attendance_limit_count && plan.attendance_limit_interval) {
    return attendanceWindowStart(plan.attendance_limit_interval, {
      periodStart: m.start_date,
      today,
      weekStart,
    });
  }
  return null;
}

export interface CheckInWarning {
  title: string;
  body: string;
}

/**
 * The warning (if any) both check-in paths show before inserting.
 * `used` = visits in the plan's limit window (limited plans) or since
 * the current cycle start (session packs). Null = check in silently.
 */
export function checkInWarning(
  plan: Pick<
    MembershipPlan,
    | "plan_type"
    | "attendance_limit_count"
    | "attendance_limit_interval"
    | "sessions_count"
  >,
  used: number,
): CheckInWarning | null {
  if (plan.plan_type === "session_pack") {
    if (!plan.sessions_count) return null;
    const left = sessionsRemaining(plan.sessions_count, used);
    if (left > 0) return null;
    return {
      title: "No sessions left",
      body: `All ${plan.sessions_count} sessions of this pack are used. You can still check them in — consider selling a new pack.`,
    };
  }
  const usage = attendanceUsage(plan, used);
  if (!usage.exceeded) return null;
  return {
    title: "Over the visit limit",
    body: `This member is at ${usage.label} (plan limit ${usage.limit}). You can still check them in.`,
  };
}
