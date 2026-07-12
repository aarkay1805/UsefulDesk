import { describe, it, expect } from "vitest";
import { planChangeQuote } from "./plan-change";

// A 30-day ₹999 cycle: 2026-07-12 → 2026-08-11.
const CYCLE = {
  periodStart: "2026-07-12",
  periodEnd: "2026-08-11",
  feeAmount: 999,
  amountPaid: 999,
};

describe("planChangeQuote", () => {
  it("credits the unused days of a fully paid cycle", () => {
    const q = planChangeQuote({ ...CYCLE, switchDate: "2026-07-20", newPlanPrice: 2999 });
    expect(q.totalDays).toBe(30);
    expect(q.usedDays).toBe(8);
    expect(q.remainingDays).toBe(22);
    expect(q.usedValue).toBe(266.4); // 999 × 8/30
    expect(q.credit).toBe(732.6); // 999 − 266.4
    expect(q.oldCycleFee).toBe(266.4);
    expect(q.netFee).toBe(2266.4); // 2999 − 732.6
    expect(q.carryover).toBe(0);
  });

  it("gives no credit when nothing was paid — old cycle keeps arrears for used days", () => {
    const q = planChangeQuote({
      ...CYCLE,
      amountPaid: 0,
      switchDate: "2026-07-20",
      newPlanPrice: 2999,
    });
    expect(q.credit).toBe(0);
    expect(q.oldCycleFee).toBe(266.4); // they still owe for the 8 used days
    expect(q.netFee).toBe(2999);
  });

  it("a partial payment only credits the surplus beyond the used value", () => {
    const q = planChangeQuote({
      ...CYCLE,
      amountPaid: 500,
      switchDate: "2026-07-20",
      newPlanPrice: 1500,
    });
    expect(q.credit).toBe(233.6); // 500 − 266.4
    expect(q.netFee).toBe(1266.4);
  });

  it("a partial payment smaller than the used value credits nothing", () => {
    const q = planChangeQuote({
      ...CYCLE,
      amountPaid: 100,
      switchDate: "2026-07-30", // 18 used days = 599.4
      newPlanPrice: 1500,
    });
    expect(q.credit).toBe(0);
    expect(q.oldCycleFee).toBe(599.4);
    expect(q.netFee).toBe(1500);
  });

  it("switching the day after start credits almost everything", () => {
    const q = planChangeQuote({ ...CYCLE, switchDate: "2026-07-13", newPlanPrice: 2999 });
    expect(q.usedDays).toBe(1);
    expect(q.usedValue).toBe(33.3);
    expect(q.credit).toBe(965.7);
  });

  it("switching on/after the cycle end credits nothing (fully used)", () => {
    const q = planChangeQuote({ ...CYCLE, switchDate: "2026-08-11", newPlanPrice: 2999 });
    expect(q.usedDays).toBe(30);
    expect(q.credit).toBe(0);
    expect(q.netFee).toBe(2999);
    const past = planChangeQuote({ ...CYCLE, switchDate: "2026-09-01", newPlanPrice: 2999 });
    expect(past.usedDays).toBe(30); // clamped
    expect(past.credit).toBe(0);
  });

  it("floors the net fee at zero and reports the carryover on a downgrade", () => {
    const q = planChangeQuote({ ...CYCLE, switchDate: "2026-07-13", newPlanPrice: 500 });
    // credit 965.7 > price 500
    expect(q.netFee).toBe(0);
    expect(q.carryover).toBe(465.7);
  });

  it("treats a degenerate cycle as fully used (no invented credit)", () => {
    const q = planChangeQuote({
      periodStart: "2026-07-12",
      periodEnd: "2026-07-12",
      feeAmount: 999,
      amountPaid: 999,
      switchDate: "2026-07-13",
      newPlanPrice: 1500,
    });
    expect(q.credit).toBe(0);
    expect(q.netFee).toBe(1500);
    const bad = planChangeQuote({
      periodStart: "not-a-date",
      periodEnd: "2026-08-11",
      feeAmount: 999,
      amountPaid: 999,
      switchDate: "2026-07-20",
      newPlanPrice: 1500,
    });
    expect(bad.credit).toBe(0);
  });

  it("never counts negative paid/fee inputs", () => {
    const q = planChangeQuote({
      ...CYCLE,
      feeAmount: -50,
      amountPaid: -100,
      switchDate: "2026-07-20",
      newPlanPrice: 1500,
    });
    expect(q.usedValue).toBe(0);
    expect(q.credit).toBe(0);
    expect(q.netFee).toBe(1500);
  });
});
