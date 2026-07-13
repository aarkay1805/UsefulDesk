import { describe, it, expect } from "vitest";
import {
  isCollectiblePeriod,
  invoicePaymentState,
  isChargeableAmount,
  periodStatus,
  projectNextInvoice,
  isProjectedInvoice,
} from "./periods";
import type { Membership, MembershipPeriodInvoice } from "@/types";

const TODAY = "2026-07-11";

type InvoiceFacts = Pick<
  MembershipPeriodInvoice,
  "state" | "fee_amount" | "amount_paid" | "balance" | "period_start"
>;

/** A billed cycle by default (fee 999); `amount_paid` follows the balance
 *  unless a case states it (over-payment, zero-fee stub). */
function inv(over: Partial<MembershipPeriodInvoice>): InvoiceFacts {
  const base = {
    state: "open" as const,
    fee_amount: 999,
    balance: 0,
    period_start: "2026-06-01",
    ...over,
  };
  return {
    ...base,
    amount_paid: over.amount_paid ?? Number(base.fee_amount) - Number(base.balance),
  };
}

describe("periodStatus", () => {
  it("void state wins over everything", () => {
    expect(periodStatus(inv({ state: "void", balance: 500 }), TODAY)).toBe("void");
  });

  it("a covered balance (<= 0) is paid, even for a past cycle", () => {
    expect(periodStatus(inv({ balance: 0, period_start: "2026-01-01" }), TODAY)).toBe("paid");
  });

  it("a cycle that billed and collected nothing is no_charge, not unpaid", () => {
    // A pro-rated plan-change stub: fee ₹0.32, nothing collected. Money
    // renders without minor units, so "Due" on a ₹0/₹0/₹0 row is a bug.
    expect(
      periodStatus(inv({ fee_amount: 0.32, amount_paid: 0, balance: 0.32 }), TODAY),
    ).toBe("no_charge");
    expect(periodStatus(inv({ fee_amount: 0, amount_paid: 0, balance: 0 }), TODAY)).toBe(
      "no_charge",
    );
  });

  it("a zero-fee stub that DID collect money is paid, not no_charge", () => {
    expect(
      periodStatus(inv({ fee_amount: 0.32, amount_paid: 500, balance: 0 }), TODAY),
    ).toBe("paid");
  });

  it("a sub-unit residue on a billed cycle is paid, not unpaid", () => {
    expect(
      periodStatus(
        inv({ fee_amount: 999, amount_paid: 998.7, balance: 0.3, period_start: "2026-07-01" }),
        TODAY,
      ),
    ).toBe("paid");
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

describe("invoicePaymentState", () => {
  it("splits paid / due / no_charge at display precision", () => {
    expect(invoicePaymentState(inv({ balance: 500 }))).toBe("due");
    expect(invoicePaymentState(inv({ balance: 0 }))).toBe("paid");
    expect(invoicePaymentState(inv({ fee_amount: 0.4, amount_paid: 0, balance: 0.4 }))).toBe(
      "no_charge",
    );
  });

  it("isChargeableAmount treats sub-half-unit money as zero", () => {
    expect(isChargeableAmount(0.49)).toBe(false);
    expect(isChargeableAmount(0.5)).toBe(true);
    expect(isChargeableAmount(1)).toBe(true);
  });
});

describe("isCollectiblePeriod", () => {
  it("only permits an open period with a positive balance", () => {
    expect(isCollectiblePeriod(inv({ balance: 500 }), "active")).toBe(true);
    expect(isCollectiblePeriod(inv({ balance: 0 }), "active")).toBe(false);
    // A residue below display precision can't be collected (the ledger's
    // ≤-balance guard rejects even a ₹1 payment against it).
    expect(isCollectiblePeriod(inv({ balance: 0.32 }), "active")).toBe(false);
    expect(isCollectiblePeriod(inv({ state: "void", balance: 500 }), "active")).toBe(false);
  });

  it("never permits collection from a cancelled membership", () => {
    expect(isCollectiblePeriod(inv({ balance: 500 }), "cancelled")).toBe(false);
  });
});

const baseOption = {
  id: "o1",
  account_id: "a1",
  plan_id: "p1",
  duration_count: 1,
  duration_unit: "month" as const,
  price: 3999,
  setup_fee: 500,
  is_active: true,
  sort_order: 0,
  created_at: "",
  updated_at: "",
};

const baseMembership: Pick<
  Membership,
  | "id"
  | "account_id"
  | "contact_id"
  | "plan_id"
  | "start_date"
  | "end_date"
  | "fee_amount"
  | "status"
  | "is_trial"
  | "plan"
  | "pricing_option"
> = {
  id: "m1",
  account_id: "a1",
  contact_id: "c1",
  plan_id: "p1",
  start_date: "2026-07-11",
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
    plan_type: "recurring",
    is_active: true,
    created_at: "",
    updated_at: "",
  },
  pricing_option: baseOption,
};

describe("projectNextInvoice", () => {
  it("starts the next cycle when the current ends, one option-duration long", () => {
    const next = projectNextInvoice(baseMembership)!;
    expect(next.period_start).toBe("2026-08-10");
    expect(next.period_end).toBe("2026-09-10"); // calendar month, not +30d
    expect(next.fee_amount).toBe(3999);
    expect(next.balance).toBe(3999);
    expect(isProjectedInvoice(next.id)).toBe(true);
  });

  it("uses the option price (no setup fee), not the current fee", () => {
    // fee_amount 4499 = first cycle price + setup fee; the projection
    // must bill the recurring price alone.
    const next = projectNextInvoice({ ...baseMembership, fee_amount: 4499 })!;
    expect(next.fee_amount).toBe(3999);
  });

  it("returns null for trials, cancelled, and option-less memberships", () => {
    expect(projectNextInvoice({ ...baseMembership, is_trial: true }, TODAY)).toBeNull();
    expect(projectNextInvoice({ ...baseMembership, status: "cancelled" }, TODAY)).toBeNull();
    expect(projectNextInvoice({ ...baseMembership, pricing_option: null }, TODAY)).toBeNull();
  });

  it("returns null for non-recurring and session-pack plans", () => {
    expect(
      projectNextInvoice(
        { ...baseMembership, plan: { ...baseMembership.plan!, plan_type: "non_recurring" } },
        TODAY,
      ),
    ).toBeNull();
    expect(
      projectNextInvoice(
        { ...baseMembership, plan: { ...baseMembership.plan!, plan_type: "session_pack" } },
        TODAY,
      ),
    ).toBeNull();
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

  it("does not project a second invoice after an early renewal", () => {
    expect(
      projectNextInvoice(
        { ...baseMembership, start_date: "2026-08-10", end_date: "2026-09-09" },
        TODAY,
      ),
    ).toBeNull();
  });
});
