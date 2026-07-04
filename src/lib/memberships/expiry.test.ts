import { describe, it, expect } from "vitest";
import {
  istToday,
  istAddDays,
  daysBetween,
  daysUntil,
  effectiveStatus,
  computeRenewalEndDate,
  unfreezeEndDate,
} from "./expiry";

describe("istToday", () => {
  it("returns the IST calendar day, not the UTC day, around the 18:30 UTC boundary", () => {
    // 2026-07-03 18:29 UTC is still 2026-07-03 23:59 IST.
    expect(istToday(new Date("2026-07-03T18:29:00Z"))).toBe("2026-07-03");
    // 2026-07-03 18:30 UTC is 2026-07-04 00:00 IST — the day has rolled over.
    expect(istToday(new Date("2026-07-03T18:30:00Z"))).toBe("2026-07-04");
  });

  it("formats as zero-padded YYYY-MM-DD", () => {
    expect(istToday(new Date("2026-01-05T06:00:00Z"))).toBe("2026-01-05");
  });
});

describe("istAddDays", () => {
  it("adds days across a month boundary", () => {
    expect(istAddDays("2026-01-30", 3)).toBe("2026-02-02");
  });
  it("subtracts with a negative offset", () => {
    expect(istAddDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("crosses a leap-year February correctly", () => {
    expect(istAddDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("daysBetween / daysUntil", () => {
  it("counts forward and backward", () => {
    expect(daysBetween("2026-07-01", "2026-07-08")).toBe(7);
    expect(daysBetween("2026-07-08", "2026-07-01")).toBe(-7);
  });
  it("daysUntil is 0 on the expiry day and negative after", () => {
    expect(daysUntil("2026-07-04", "2026-07-04")).toBe(0);
    expect(daysUntil("2026-07-01", "2026-07-04")).toBe(-3);
  });
});

describe("effectiveStatus", () => {
  const today = "2026-07-04";
  it("keeps an active membership active when not yet past", () => {
    expect(effectiveStatus({ status: "active", end_date: "2026-07-10" }, today)).toBe("active");
    expect(effectiveStatus({ status: "active", end_date: "2026-07-04" }, today)).toBe("active");
  });
  it("derives expired for an active membership past its end date", () => {
    expect(effectiveStatus({ status: "active", end_date: "2026-07-03" }, today)).toBe("expired");
  });
  it("passes frozen and cancelled through unchanged even when past", () => {
    expect(effectiveStatus({ status: "frozen", end_date: "2026-07-01" }, today)).toBe("frozen");
    expect(effectiveStatus({ status: "cancelled", end_date: "2026-07-01" }, today)).toBe("cancelled");
  });
});

describe("computeRenewalEndDate", () => {
  const today = "2026-07-04";
  it("extends from the current expiry when still active (no days burned)", () => {
    expect(computeRenewalEndDate("2026-07-20", 30, today)).toBe("2026-08-19");
  });
  it("extends from today when already expired", () => {
    expect(computeRenewalEndDate("2026-06-01", 30, today)).toBe("2026-08-03");
  });
  it("starts from today when there is no current expiry", () => {
    expect(computeRenewalEndDate(null, 30, today)).toBe("2026-08-03");
  });
  it("treats an expiry equal to today as extend-from-today", () => {
    expect(computeRenewalEndDate("2026-07-04", 30, today)).toBe("2026-08-03");
  });
});

describe("unfreezeEndDate", () => {
  const today = "2026-07-04";
  it("pushes expiry forward by the frozen span", () => {
    // Frozen on 2026-06-24, unfrozen 10 days later → +10 days of expiry.
    expect(unfreezeEndDate("2026-07-10", "2026-06-24", today)).toBe("2026-07-20");
  });
  it("leaves expiry unchanged when frozenAt is missing", () => {
    expect(unfreezeEndDate("2026-07-10", null, today)).toBe("2026-07-10");
  });
  it("leaves expiry unchanged when frozenAt is today (zero span)", () => {
    expect(unfreezeEndDate("2026-07-10", "2026-07-04", today)).toBe("2026-07-10");
  });
});
