import { describe, it, expect } from "vitest";
import {
  normalizeDaysBefore,
  isRemindableStatus,
  targetEndDates,
  DEFAULT_DAYS_BEFORE,
  MAX_REMINDER_OFFSETS,
} from "./renewal-reminders";

describe("normalizeDaysBefore", () => {
  it("sorts ascending and de-duplicates", () => {
    expect(normalizeDaysBefore([7, 1, 3, 7, 1])).toEqual([1, 3, 7]);
  });

  it("keeps 0 (expires today) but drops negatives", () => {
    expect(normalizeDaysBefore([-5, 0, 3])).toEqual([0, 3]);
  });

  it("truncates fractional days to whole days", () => {
    expect(normalizeDaysBefore([3.9, 1.1])).toEqual([1, 3]);
  });

  it("drops non-numbers and out-of-range values", () => {
    expect(normalizeDaysBefore([7, "3", null, 400, NaN, 3])).toEqual([3, 7]);
  });

  it("caps at MAX_REMINDER_OFFSETS", () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(normalizeDaysBefore(many)).toHaveLength(MAX_REMINDER_OFFSETS);
    expect(normalizeDaysBefore(many)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeDaysBefore(undefined)).toEqual([]);
    expect(normalizeDaysBefore(null)).toEqual([]);
    expect(normalizeDaysBefore("7,3,1")).toEqual([]);
  });

  it("accepts the shipped default", () => {
    expect(normalizeDaysBefore(DEFAULT_DAYS_BEFORE)).toEqual([1, 3, 7]);
  });
});

describe("isRemindableStatus", () => {
  it("reminds only active memberships", () => {
    expect(isRemindableStatus("active")).toBe(true);
    expect(isRemindableStatus("frozen")).toBe(false);
    expect(isRemindableStatus("cancelled")).toBe(false);
    expect(isRemindableStatus("expired")).toBe(false);
  });
});

describe("targetEndDates", () => {
  it("maps offsets to the exact expiry dates that fire today", () => {
    // today + N days = the end_date of a membership N days from expiry.
    expect(targetEndDates([7, 3, 1], "2026-07-04")).toEqual([
      { daysBefore: 1, endDate: "2026-07-05" },
      { daysBefore: 3, endDate: "2026-07-07" },
      { daysBefore: 7, endDate: "2026-07-11" },
    ]);
  });

  it("offset 0 targets today (expires today)", () => {
    expect(targetEndDates([0], "2026-07-04")).toEqual([
      { daysBefore: 0, endDate: "2026-07-04" },
    ]);
  });

  it("crosses month boundaries via IST-safe date math", () => {
    expect(targetEndDates([3], "2026-01-30")).toEqual([
      { daysBefore: 3, endDate: "2026-02-02" },
    ]);
  });

  it("normalises the raw array before mapping", () => {
    // Duplicates + bad values collapse; result stays ordered + clean.
    expect(targetEndDates([3, 3, -1, "x"] as unknown, "2026-07-04")).toEqual([
      { daysBefore: 3, endDate: "2026-07-07" },
    ]);
  });
});
