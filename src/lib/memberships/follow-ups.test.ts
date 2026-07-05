import { describe, it, expect } from "vitest";
import type { FollowUp, Membership } from "@/types";
import { bucketFollowUps, defaultReason } from "./follow-ups";

const today = "2026-07-05";

describe("bucketFollowUps", () => {
  // Minimal factory — only the fields bucketFollowUps reads.
  const task = (due_date: string): FollowUp =>
    ({
      id: Math.random().toString(36).slice(2),
      account_id: "a",
      contact_id: "c",
      created_by: "u",
      reason: "renewal",
      due_date,
      status: "open",
      created_at: "",
      updated_at: "",
    }) as FollowUp;

  it("splits by due date against today", () => {
    const res = bucketFollowUps(
      [
        task("2026-07-01"), // overdue
        task("2026-07-05"), // today
        task("2026-07-09"), // upcoming
      ],
      today,
    );
    expect(res.overdue.map((f) => f.due_date)).toEqual(["2026-07-01"]);
    expect(res.dueToday.map((f) => f.due_date)).toEqual(["2026-07-05"]);
    expect(res.upcoming.map((f) => f.due_date)).toEqual(["2026-07-09"]);
  });

  it("preserves input order inside each bucket", () => {
    const res = bucketFollowUps(
      [task("2026-07-02"), task("2026-07-01"), task("2026-07-03")],
      today,
    );
    expect(res.overdue.map((f) => f.due_date)).toEqual([
      "2026-07-02",
      "2026-07-01",
      "2026-07-03",
    ]);
  });

  it("handles an empty list", () => {
    const res = bucketFollowUps([], today);
    expect(res.overdue).toEqual([]);
    expect(res.dueToday).toEqual([]);
    expect(res.upcoming).toEqual([]);
  });
});

describe("defaultReason", () => {
  const member = (over: Partial<Membership>): Membership =>
    ({
      id: "m",
      account_id: "a",
      contact_id: "c",
      user_id: "u",
      plan_id: null,
      start_date: "2026-06-01",
      end_date: "2026-08-01",
      status: "active",
      fee_amount: 1000,
      fee_status: "paid",
      is_trial: false,
      created_at: "",
      updated_at: "",
      ...over,
    }) as Membership;

  it("is trial for a trial row regardless of dates", () => {
    expect(defaultReason(member({ is_trial: true, end_date: "2026-07-01" }), today)).toBe(
      "trial",
    );
  });

  it("is renewal when expired or expiring within 7 days", () => {
    expect(defaultReason(member({ end_date: "2026-07-01" }), today)).toBe("renewal"); // expired
    expect(defaultReason(member({ end_date: "2026-07-05" }), today)).toBe("renewal"); // today
    expect(defaultReason(member({ end_date: "2026-07-12" }), today)).toBe("renewal"); // 7d
  });

  it("is payment when the fee is due and expiry is far off", () => {
    expect(
      defaultReason(member({ fee_status: "due", end_date: "2026-08-01" }), today),
    ).toBe("payment");
  });

  it("is other for a paid-up member with a distant expiry", () => {
    expect(defaultReason(member({}), today)).toBe("other");
  });
});
