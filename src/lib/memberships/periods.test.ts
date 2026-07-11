import { describe, it, expect } from "vitest";
import { periodStatus, projectNextInvoice, isProjectedInvoice } from "./periods";
import type { Membership, MembershipPeriodInvoice } from "@/types";

const TODAY = "2026-07-11";

function inv(
  over: Partial<MembershipPeriodInvoice>,
): Pick<MembershipPeriodInvoice, "state" | "balance" | "period_start"> {
  return { state: "open", balance: 0, period_start: "2026-06-01", ...over };
}

describe("periodStatus", () => {
  it("void state wins over everything", () => {
    expect(periodStatus(inv({ state: "void", balance: 500 }), TODAY)).toBe("void");
  });

  it("a covered balance (<= 0) is paid, even for a past cycle", () => {
    expect(periodStatus(inv({ balance: 0, period_start: "2026-01-01" }), TODAY)).toBe("paid");
  });

  it("a future cycle with an outstanding balance is upcoming", () => {
    expect(periodStatus(inv({ balance: 999, period_start: "2026-08-11" }), TODAY)).toBe("upcoming");
  });

  it("a started cycle with a balance is unpaid", () => {
    expect(periodStatus(inv({ balance: 999, period_start: "2026-07-01" }), TODAY)).toBe("unpaid");
  });

  it("today's start counts as started (not upcoming)", () => {
    expect(periodStatus(inv({ balance: 999, period_start: TODAY }), TODAY)).toBe("unpaid");
  });

  it("a future cycle that's already paid reads paid, not upcoming", () => {
    // balance wins: pre-paid next cycle.
    expect(periodStatus(inv({ balance: 0, period_start: "2026-09-01" }), TODAY)).toBe("paid");
  });
});

const baseMembership: Pick<
  Membership,
  "id" | "account_id" | "contact_id" | "plan_id" | "end_date" | "fee_amount" | "status" | "is_trial" | "plan"
> = {
  id: "m1",
  account_id: "a1",
  contact_id: "c1",
  plan_id: "p1",
  end_date: "2026-08-10",
  fee_amount: 3999,
  status: "active",
  is_trial: false,
  plan: {
    id: "p1",
    account_id: "a1",
    name: "Monthly",
    price: 3999,
    duration_days: 30,
    is_active: true,
    created_at: "",
    updated_at: "",
  },
};

describe("projectNextInvoice", () => {
  it("starts the next cycle when the current ends, one plan-duration long", () => {
    const next = projectNextInvoice(baseMembership)!;
    expect(next.period_start).toBe("2026-08-10");
    expect(next.period_end).toBe("2026-09-09");
    expect(next.fee_amount).toBe(3999);
    expect(next.balance).toBe(3999);
    expect(isProjectedInvoice(next.id)).toBe(true);
  });

  it("uses the plan price, not the (possibly discounted) current fee", () => {
    const next = projectNextInvoice({ ...baseMembership, fee_amount: 0 })!;
    expect(next.fee_amount).toBe(3999);
  });

  it("returns null for trials, cancelled, and planless memberships", () => {
    expect(projectNextInvoice({ ...baseMembership, is_trial: true }, TODAY)).toBeNull();
    expect(projectNextInvoice({ ...baseMembership, status: "cancelled" }, TODAY)).toBeNull();
    expect(projectNextInvoice({ ...baseMembership, plan: undefined }, TODAY)).toBeNull();
  });

  it("returns null for an expired member (no phantom past-dated Upcoming)", () => {
    // end_date before today — projecting would create a past-dated cycle
    // that reads as Unpaid. Must be suppressed until they renew.
    expect(projectNextInvoice({ ...baseMembership, end_date: "2026-01-01" }, TODAY)).toBeNull();
  });

  it("returns null when the current cycle ends exactly today", () => {
    expect(projectNextInvoice({ ...baseMembership, end_date: TODAY }, TODAY)).toBeNull();
  });

  it("projects while the current cycle is still live", () => {
    expect(projectNextInvoice(baseMembership, TODAY)).not.toBeNull();
  });
});
