import { describe, it, expect } from "vitest";
import type { Membership } from "@/types";
import { trialBucket, partitionTrials } from "./trials";

describe("trialBucket", () => {
  const today = "2026-07-05";

  it("is ending_today when the trial expires today", () => {
    expect(trialBucket("2026-07-05", today)).toBe("ending_today");
  });

  it("is ending_soon from tomorrow through 7 days out (inclusive)", () => {
    expect(trialBucket("2026-07-06", today)).toBe("ending_soon"); // 1d
    expect(trialBucket("2026-07-12", today)).toBe("ending_soon"); // 7d
  });

  it("is null when the trial has more than a week left", () => {
    expect(trialBucket("2026-07-13", today)).toBeNull(); // 8d
  });

  it("is expired_unconverted once the trial end_date is in the past", () => {
    expect(trialBucket("2026-07-04", today)).toBe("expired_unconverted"); // 1d ago
    expect(trialBucket("2026-06-01", today)).toBe("expired_unconverted");
  });

  it("is null for a malformed date", () => {
    expect(trialBucket("not-a-date", today)).toBeNull();
  });
});

describe("partitionTrials", () => {
  const today = "2026-07-05";

  // Minimal membership factory — only the fields partitionTrials reads.
  const trial = (over: Partial<Membership>): Membership =>
    ({
      id: Math.random().toString(36).slice(2),
      account_id: "a",
      contact_id: "c",
      user_id: "u",
      plan_id: null,
      start_date: "2026-07-01",
      end_date: "2026-07-05",
      status: "active",
      fee_amount: 0,
      fee_status: "due",
      is_trial: true,
      converted_at: null,
      created_at: "",
      updated_at: "",
      ...over,
    }) as Membership;

  it("routes each trial into the right bucket", () => {
    const res = partitionTrials(
      [
        trial({ end_date: "2026-07-05" }), // today
        trial({ end_date: "2026-07-08" }), // soon
        trial({ end_date: "2026-07-01" }), // expired
      ],
      today,
    );
    expect(res.ending_today).toHaveLength(1);
    expect(res.ending_soon).toHaveLength(1);
    expect(res.expired_unconverted).toHaveLength(1);
  });

  it("drops non-trials, converted, and cancelled rows", () => {
    const res = partitionTrials(
      [
        trial({ end_date: "2026-07-05", is_trial: false }),
        trial({ end_date: "2026-07-05", converted_at: "2026-07-04T00:00:00Z" }),
        trial({ end_date: "2026-07-01", status: "cancelled" }),
      ],
      today,
    );
    expect(res.ending_today).toHaveLength(0);
    expect(res.ending_soon).toHaveLength(0);
    expect(res.expired_unconverted).toHaveLength(0);
  });

  it("drops trials with more than a week left (not yet actionable)", () => {
    const res = partitionTrials([trial({ end_date: "2026-07-20" })], today);
    expect(res.ending_today).toHaveLength(0);
    expect(res.ending_soon).toHaveLength(0);
    expect(res.expired_unconverted).toHaveLength(0);
  });
});
