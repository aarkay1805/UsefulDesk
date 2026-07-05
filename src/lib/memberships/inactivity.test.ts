import { describe, it, expect } from "vitest";
import type { MemberActivity } from "@/types";
import {
  istDayOf,
  daysSinceVisit,
  partitionInactivity,
} from "./inactivity";

const today = "2026-07-05";

// Minimal factory — only the fields the partition logic reads.
const row = (over: Partial<MemberActivity>): MemberActivity =>
  ({
    membership_id: Math.random().toString(36).slice(2),
    account_id: "a",
    contact_id: "c",
    plan_id: null,
    start_date: "2026-06-01",
    end_date: "2026-09-01",
    status: "active",
    fee_status: "paid",
    fee_amount: 1000,
    is_trial: false,
    contact_name: "M",
    contact_phone: "+91",
    plan_name: null,
    last_visit_at: null,
    visit_count: 0,
    ...over,
  }) as MemberActivity;

describe("istDayOf", () => {
  it("converts a UTC instant to its IST calendar day", () => {
    // 20:00 UTC = 01:30 IST next day.
    expect(istDayOf("2026-07-04T20:00:00Z")).toBe("2026-07-05");
    expect(istDayOf("2026-07-04T10:00:00Z")).toBe("2026-07-04");
  });
});

describe("daysSinceVisit", () => {
  it("is null when the member never visited", () => {
    expect(daysSinceVisit(row({}), today)).toBeNull();
  });

  it("counts whole IST days since the last visit", () => {
    expect(
      daysSinceVisit(row({ last_visit_at: "2026-07-01T05:00:00Z", visit_count: 1 }), today),
    ).toBe(4);
  });

  it("is 0 for a visit earlier today (IST)", () => {
    expect(
      daysSinceVisit(row({ last_visit_at: "2026-07-05T03:00:00Z", visit_count: 1 }), today),
    ).toBe(0);
  });
});

describe("partitionInactivity", () => {
  it("routes members into inactive / neverVisited and drops the recently active", () => {
    const res = partitionInactivity(
      [
        row({ membership_id: "recent", last_visit_at: "2026-07-03T05:00:00Z", visit_count: 5 }), // 2d — active
        row({ membership_id: "stale", last_visit_at: "2026-06-20T05:00:00Z", visit_count: 9 }), // 15d — inactive
        row({ membership_id: "ghost" }), // never visited
      ],
      today,
    );
    expect(res.inactive.map((r) => r.membership_id)).toEqual(["stale"]);
    expect(res.neverVisited.map((r) => r.membership_id)).toEqual(["ghost"]);
  });

  it("treats exactly the threshold as inactive (10 days by default)", () => {
    const res = partitionInactivity(
      [row({ last_visit_at: "2026-06-25T05:00:00Z", visit_count: 1 })], // 10d
      today,
    );
    expect(res.inactive).toHaveLength(1);
  });

  it("sorts inactive stalest-first and neverVisited by start date", () => {
    const res = partitionInactivity(
      [
        row({ membership_id: "b", last_visit_at: "2026-06-20T05:00:00Z", visit_count: 1 }),
        row({ membership_id: "a", last_visit_at: "2026-06-10T05:00:00Z", visit_count: 1 }),
        row({ membership_id: "new", start_date: "2026-07-01" }),
        row({ membership_id: "old", start_date: "2026-05-01" }),
      ],
      today,
    );
    expect(res.inactive.map((r) => r.membership_id)).toEqual(["a", "b"]);
    expect(res.neverVisited.map((r) => r.membership_id)).toEqual(["old", "new"]);
  });

  it("respects a custom threshold", () => {
    const res = partitionInactivity(
      [row({ last_visit_at: "2026-07-01T05:00:00Z", visit_count: 1 })], // 4d
      today,
      3,
    );
    expect(res.inactive).toHaveLength(1);
  });
});
