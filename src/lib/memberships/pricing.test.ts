import { describe, it, expect } from "vitest";

import {
  activeOptions,
  defaultOption,
  durationLabel,
  firstCycleFee,
  isRenewalChaseable,
  optionEndDate,
  renewalFee,
} from "./pricing";
import type { MembershipPlan, PlanPricingOption } from "@/types";

function opt(over: Partial<PlanPricingOption>): PlanPricingOption {
  return {
    id: "o1",
    account_id: "a1",
    plan_id: "p1",
    duration_count: 1,
    duration_unit: "month",
    price: 1000,
    setup_fee: 0,
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "",
    ...over,
  };
}

function plan(options: PlanPricingOption[]): MembershipPlan {
  return {
    id: "p1",
    account_id: "a1",
    name: "Gold",
    price: 1000,
    duration_days: 30,
    plan_type: "recurring",
    is_active: true,
    created_at: "",
    updated_at: "",
    pricing_options: options,
  };
}

describe("activeOptions / defaultOption", () => {
  it("filters archived options and sorts by sort_order then created_at", () => {
    const p = plan([
      opt({ id: "late", sort_order: 1 }),
      opt({ id: "archived", sort_order: 0, is_active: false }),
      opt({ id: "tie-b", sort_order: 0, created_at: "2026-02-01T00:00:00Z" }),
      opt({ id: "tie-a", sort_order: 0, created_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(activeOptions(p).map((o) => o.id)).toEqual(["tie-a", "tie-b", "late"]);
    expect(defaultOption(p)?.id).toBe("tie-a");
  });

  it("handles a plan with no options", () => {
    expect(activeOptions(plan([]))).toEqual([]);
    expect(defaultOption(plan([]))).toBeNull();
    expect(defaultOption({ ...plan([]), pricing_options: undefined })).toBeNull();
  });
});

describe("optionEndDate", () => {
  it("is calendar-accurate per the option's unit", () => {
    expect(optionEndDate("2026-01-31", opt({ duration_count: 1, duration_unit: "month" }))).toBe(
      "2026-02-28",
    );
    expect(optionEndDate("2026-07-11", opt({ duration_count: 90, duration_unit: "day" }))).toBe(
      "2026-10-09",
    );
  });
});

describe("fees", () => {
  it("first cycle includes the setup fee; renewals never do", () => {
    const o = opt({ price: 1000, setup_fee: 500 });
    expect(firstCycleFee(o)).toBe(1500);
    expect(renewalFee(o)).toBe(1000);
  });

  it("treats a missing/zero setup fee as zero", () => {
    expect(firstCycleFee(opt({ price: 1000, setup_fee: 0 }))).toBe(1000);
  });
});

describe("durationLabel", () => {
  it("pluralizes correctly", () => {
    expect(durationLabel(1, "month")).toBe("1 month");
    expect(durationLabel(3, "month")).toBe("3 months");
    expect(durationLabel(90, "day")).toBe("90 days");
    expect(durationLabel(1, "year")).toBe("1 year");
  });
});

describe("isRenewalChaseable", () => {
  it("chases recurring plans and legacy NULL-plan rows only", () => {
    expect(isRenewalChaseable({ plan_type: "recurring" })).toBe(true);
    // Load-bearing: pre-062 rows without a plan keep their reminders.
    expect(isRenewalChaseable(null)).toBe(true);
    expect(isRenewalChaseable(undefined)).toBe(true);
    expect(isRenewalChaseable({ plan_type: "non_recurring" })).toBe(false);
    expect(isRenewalChaseable({ plan_type: "session_pack" })).toBe(false);
  });
});
