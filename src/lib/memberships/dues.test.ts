import { describe, it, expect } from "vitest";
import { daysOverdue, bucketForDue } from "./dues";

describe("daysOverdue", () => {
  it("is 0 when the fee is due today", () => {
    expect(daysOverdue("2026-07-05", "2026-07-05")).toBe(0);
  });
  it("is positive when the period started in the past", () => {
    expect(daysOverdue("2026-07-01", "2026-07-05")).toBe(4);
  });
  it("is negative for a future period start (not owed yet)", () => {
    expect(daysOverdue("2026-07-10", "2026-07-05")).toBe(-5);
  });
});

describe("bucketForDue", () => {
  const today = "2026-07-05";

  it("puts due-today and not-yet-owed in due_soon", () => {
    expect(bucketForDue("2026-07-05", today)).toBe("due_soon");
    expect(bucketForDue("2026-07-20", today)).toBe("due_soon");
  });
  it("splits at the 7-day boundary", () => {
    expect(bucketForDue("2026-07-04", today)).toBe("overdue_1_7"); // 1d
    expect(bucketForDue("2026-06-28", today)).toBe("overdue_1_7"); // 7d
    expect(bucketForDue("2026-06-27", today)).toBe("overdue_8_30"); // 8d
  });
  it("splits at the 30-day boundary", () => {
    expect(bucketForDue("2026-06-05", today)).toBe("overdue_8_30"); // 30d
    expect(bucketForDue("2026-06-04", today)).toBe("overdue_30_plus"); // 31d
  });
});
