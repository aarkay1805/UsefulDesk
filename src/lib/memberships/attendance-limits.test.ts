import { describe, it, expect } from "vitest";

import {
  attendanceUsage,
  attendanceWindowStart,
  checkInWarning,
  sessionsRemaining,
  usageSummary,
} from "./attendance-limits";
import type { MembershipPlan } from "@/types";

const TODAY = "2026-07-11"; // a Saturday

function limitedPlan(
  over: Partial<
    Pick<
      MembershipPlan,
      "plan_type" | "attendance_limit_count" | "attendance_limit_interval" | "sessions_count"
    >
  > = {},
) {
  return {
    plan_type: "recurring" as const,
    attendance_limit_count: 12,
    attendance_limit_interval: "month" as const,
    sessions_count: null,
    ...over,
  };
}

describe("attendanceWindowStart", () => {
  const base = { periodStart: "2026-06-20", today: TODAY, weekStart: 1 };

  it("'period' starts at the current billing cycle", () => {
    expect(attendanceWindowStart("period", base)).toBe("2026-06-20");
  });

  it("'month' starts on the 1st of today's month", () => {
    expect(attendanceWindowStart("month", base)).toBe("2026-07-01");
  });

  it("'week' snaps back to the locale week start", () => {
    // 2026-07-11 is a Saturday.
    expect(attendanceWindowStart("week", { ...base, weekStart: 1 })).toBe("2026-07-06"); // Monday
    expect(attendanceWindowStart("week", { ...base, weekStart: 0 })).toBe("2026-07-05"); // Sunday
    expect(attendanceWindowStart("week", { ...base, weekStart: 6 })).toBe("2026-07-11"); // Saturday = today
  });
});

describe("attendanceUsage", () => {
  it("reports usage vs the limit with an interval label", () => {
    const u = attendanceUsage(limitedPlan(), 9);
    expect(u).toEqual({ limit: 12, used: 9, exceeded: false, label: "9/12 this month" });
  });

  it("flags exceeded at the limit, not only past it", () => {
    expect(attendanceUsage(limitedPlan(), 12).exceeded).toBe(true);
    expect(attendanceUsage(limitedPlan(), 13).exceeded).toBe(true);
  });

  it("is unlimited when the plan has no limit or is a session pack", () => {
    expect(attendanceUsage(limitedPlan({ attendance_limit_count: null }), 99).limit).toBeNull();
    expect(attendanceUsage(limitedPlan({ plan_type: "session_pack" }), 99).limit).toBeNull();
  });
});

describe("sessionsRemaining", () => {
  it("clamps at zero", () => {
    expect(sessionsRemaining(10, 3)).toBe(7);
    expect(sessionsRemaining(10, 12)).toBe(0);
  });
});

describe("checkInWarning", () => {
  it("stays silent under the limit, warns at it", () => {
    expect(checkInWarning(limitedPlan(), 11)).toBeNull();
    const warn = checkInWarning(limitedPlan(), 12);
    expect(warn?.title).toBe("Over the visit limit");
    expect(warn?.body).toContain("12/12 this month");
  });

  it("warns when a session pack is exhausted", () => {
    const pack = limitedPlan({
      plan_type: "session_pack",
      attendance_limit_count: null,
      attendance_limit_interval: null,
      sessions_count: 10,
    });
    expect(checkInWarning(pack, 9)).toBeNull();
    expect(checkInWarning(pack, 10)?.title).toBe("No sessions left");
  });

  it("never warns for an unlimited plan", () => {
    expect(checkInWarning(limitedPlan({ attendance_limit_count: null }), 999)).toBeNull();
  });
});

describe("usageSummary", () => {
  it("labels a limited plan and flags danger only when exceeded", () => {
    expect(usageSummary(limitedPlan(), 9)).toEqual({
      label: "9/12 this month",
      danger: false,
    });
    expect(usageSummary(limitedPlan(), 12)).toEqual({
      label: "12/12 this month",
      danger: true,
    });
  });

  it("labels a session pack and flags danger only when exhausted", () => {
    const pack = limitedPlan({
      plan_type: "session_pack",
      attendance_limit_count: null,
      attendance_limit_interval: null,
      sessions_count: 10,
    });
    expect(usageSummary(pack, 3)).toEqual({
      label: "7 of 10 sessions left",
      danger: false,
    });
    expect(usageSummary(pack, 10)).toEqual({
      label: "0 of 10 sessions left",
      danger: true,
    });
  });

  it("returns null for an unlimited plan", () => {
    expect(usageSummary(limitedPlan({ attendance_limit_count: null }), 99)).toBeNull();
  });

  it("stays consistent with checkInWarning at the threshold", () => {
    // The row label and the override dialog must agree: danger ⇔ warning.
    for (const used of [11, 12]) {
      const summary = usageSummary(limitedPlan(), used);
      expect(summary?.danger).toBe(checkInWarning(limitedPlan(), used) !== null);
    }
  });
});
