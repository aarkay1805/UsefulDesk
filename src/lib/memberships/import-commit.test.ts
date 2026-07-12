import { describe, expect, it } from "vitest";

import {
  applyMemberMapping,
  autoMapMemberColumns,
  buildMembershipRow,
  MEMBER_IGNORE_KEY,
  parseFeeStatus,
  parseImportDate,
  resolvePlan,
} from "./import-commit";
import type { MembershipPlan } from "@/types";

function opt(
  id: string,
  planId: string,
  count: number,
  unit: "day" | "week" | "month" | "year",
  price: number,
) {
  return {
    id,
    account_id: "a1",
    plan_id: planId,
    duration_count: count,
    duration_unit: unit,
    price,
    setup_fee: 500, // must NOT leak into import fees
    is_active: true,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };
}

const PLANS = [
  {
    id: "p-month",
    name: "Monthly",
    price: 1500,
    duration_days: 30,
    plan_type: "recurring",
    pricing_options: [opt("o-month", "p-month", 30, "day", 1500)],
  },
  {
    id: "p-quarter",
    name: "Quarterly",
    price: 4000,
    duration_days: 90,
    plan_type: "recurring",
    pricing_options: [opt("o-quarter", "p-quarter", 3, "month", 4000)],
  },
  {
    id: "p-bare",
    name: "Bare",
    price: 0,
    duration_days: 30,
    plan_type: "recurring",
    pricing_options: [],
  },
] as unknown as MembershipPlan[];

const TODAY = "2026-07-11";

describe("autoMapMemberColumns", () => {
  it("maps synonym headers and ignores unknowns", () => {
    expect(
      autoMapMemberColumns(["Member Name", "WhatsApp", "Package", "Valid till", "Notes"])
    ).toEqual(["name", "phone", "plan", "end_date", MEMBER_IGNORE_KEY]);
  });

  it("assigns each target at most once", () => {
    expect(autoMapMemberColumns(["Phone", "Mobile"])).toEqual([
      "phone",
      MEMBER_IGNORE_KEY,
    ]);
  });
});

describe("applyMemberMapping", () => {
  const mapping = ["name", "phone", "plan"];

  it("drops phoneless rows and in-file duplicates", () => {
    const { rows, skippedNoPhone, skippedDuplicate } = applyMemberMapping(
      [
        ["Asha", "9876543210", "Monthly"],
        ["NoPhone", "", "Monthly"],
        // Same digits, different formatting — the canonical normalizeKey
        // (digits-only, same as contacts.phone_normalized) catches it.
        ["Asha again", "98765 43210", "Monthly"],
      ],
      mapping
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe("9876543210");
    expect(skippedNoPhone).toBe(1);
    expect(skippedDuplicate).toBe(1);
  });
});

describe("parseImportDate", () => {
  it("passes ISO through day-exact", () => {
    expect(parseImportDate("2026-07-01")).toBe("2026-07-01");
  });

  it("parses DMY by default (India-first)", () => {
    expect(parseImportDate("01/07/2026")).toBe("2026-07-01");
    expect(parseImportDate("1-7-26")).toBe("2026-07-01");
  });

  it("respects MDY when declared, but a >12 first part is always a day", () => {
    expect(parseImportDate("07/01/2026", "MDY")).toBe("2026-07-01");
    expect(parseImportDate("15/07/2026", "MDY")).toBe("2026-07-15");
  });

  it("rejects garbage", () => {
    expect(parseImportDate("soon")).toBeNull();
    expect(parseImportDate("32/13/2026")).toBeNull();
  });
});

describe("resolvePlan / parseFeeStatus", () => {
  it("matches plans case-insensitively", () => {
    expect(resolvePlan("  monthly ", PLANS)?.id).toBe("p-month");
    expect(resolvePlan("Gold", PLANS)).toBeNull();
  });

  it("normalizes paid-ish words", () => {
    expect(parseFeeStatus("PAID")).toBe("paid");
    expect(parseFeeStatus("yes")).toBe("paid");
    expect(parseFeeStatus("pending")).toBe("due");
    expect(parseFeeStatus("")).toBe("due");
  });
});

describe("buildMembershipRow", () => {
  const base = {
    phone: "9876543210",
    name: "Asha",
    email: "",
    planName: "Monthly",
    startDate: "",
    endDate: "",
    fee: "",
    feeStatus: "",
  };

  it("defaults start=today, end=option duration, fee=option price (no setup fee), status=due", () => {
    const { membership, errors } = buildMembershipRow(base, PLANS, "DMY", TODAY);
    expect(errors).toEqual([]);
    expect(membership).toEqual({
      plan_id: "p-month",
      pricing_option_id: "o-month",
      start_date: TODAY,
      end_date: "2026-08-10",
      fee_amount: 1500, // option price alone — setup_fee (500) excluded
      fee_status: "due",
    });
  });

  it("computes calendar-month ends for month-unit options", () => {
    const { membership } = buildMembershipRow(
      { ...base, planName: "Quarterly", startDate: "15/06/2026" },
      PLANS,
      "DMY",
      TODAY
    );
    expect(membership?.end_date).toBe("2026-09-15"); // 3 calendar months, not +90d
  });

  it("honours explicit dates, fee (₹/commas), and paid status", () => {
    const { membership } = buildMembershipRow(
      {
        ...base,
        planName: "Quarterly",
        startDate: "15/06/2026",
        endDate: "14/09/2026",
        fee: "₹4,000",
        feeStatus: "paid",
      },
      PLANS,
      "DMY",
      TODAY
    );
    expect(membership).toEqual({
      plan_id: "p-quarter",
      pricing_option_id: "o-quarter",
      start_date: "2026-06-15",
      end_date: "2026-09-14",
      fee_amount: 4000,
      fee_status: "paid",
    });
  });

  it("errors on a plan with no active pricing option", () => {
    const { membership, errors } = buildMembershipRow(
      { ...base, planName: "Bare" },
      PLANS,
      "DMY",
      TODAY
    );
    expect(membership).toBeNull();
    expect(errors).toContain("no-pricing");
  });

  it("reports unknown plans and bad dates as errors, not throws", () => {
    const unknown = buildMembershipRow(
      { ...base, planName: "Gold" },
      PLANS,
      "DMY",
      TODAY
    );
    expect(unknown.membership).toBeNull();
    expect(unknown.errors).toContain("unknown-plan");

    const badDate = buildMembershipRow(
      { ...base, startDate: "sometime" },
      PLANS,
      "DMY",
      TODAY
    );
    expect(badDate.membership).toBeNull();
    expect(badDate.errors).toContain("bad-date");
  });
});
