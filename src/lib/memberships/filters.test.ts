import { describe, expect, it } from "vitest";

import {
  activeMemberFilterCount,
  applyMemberFilters,
  EMPTY_MEMBER_FILTERS,
  memberStatusOrClause,
} from "./filters";

const TODAY = "2026-07-11";

describe("memberStatusOrClause", () => {
  it("returns null when no statuses selected", () => {
    expect(memberStatusOrClause([], TODAY)).toBeNull();
  });

  it("derives active from status + IST day boundary + non-trial", () => {
    expect(memberStatusOrClause(["active"], TODAY)).toBe(
      "and(status.eq.active,is_trial.eq.false,end_date.gte.2026-07-11)"
    );
  });

  it("derives expired as still-active rows past their end date", () => {
    expect(memberStatusOrClause(["expired"], TODAY)).toBe(
      "and(status.eq.active,is_trial.eq.false,end_date.lt.2026-07-11)"
    );
  });

  it("ORs multiple selections", () => {
    expect(memberStatusOrClause(["frozen", "trial"], TODAY)).toBe(
      "status.eq.frozen,is_trial.eq.true"
    );
  });
});

describe("applyMemberFilters", () => {
  // Minimal recording stub matching the structural query interface.
  function stub() {
    const calls: [string, unknown][] = [];
    const q = {
      calls,
      in(column: string, values: readonly string[]) {
        calls.push(["in", { column, values }]);
        return q;
      },
      eq(column: string, value: string | boolean) {
        calls.push(["eq", { column, value }]);
        return q;
      },
      or(filters: string) {
        calls.push(["or", filters]);
        return q;
      },
    };
    return q;
  }

  it("applies nothing for empty filters", () => {
    const q = stub();
    applyMemberFilters(q, EMPTY_MEMBER_FILTERS, TODAY);
    expect(q.calls).toEqual([]);
  });

  it("applies plan, fee, churn, follow-up, and status facets", () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        plans: ["p1"],
        feeStatus: ["due"],
        statuses: ["cancelled"],
        churnRisk: ["yes"],
        followUps: ["open"],
      },
      TODAY
    );
    expect(q.calls).toEqual([
      ["in", { column: "plan_id", values: ["p1"] }],
      ["in", { column: "fee_status", values: ["due"] }],
      ["eq", { column: "contact.churn_risk", value: true }],
      ["eq", { column: "open_follow_ups.status", value: "open" }],
      ["or", "status.eq.cancelled"],
    ]);
  });

  it("filters members not marked as churn risk", () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        plans: [],
        feeStatus: [],
        statuses: [],
        churnRisk: ["no"],
        followUps: [],
      },
      TODAY
    );
    expect(q.calls).toEqual([
      ["eq", { column: "contact.churn_risk", value: false }],
    ]);
  });

  it("does not constrain churn risk when both values are selected", () => {
    const q = stub();
    applyMemberFilters(
      q,
      {
        plans: [],
        feeStatus: [],
        statuses: [],
        churnRisk: ["yes", "no"],
        followUps: [],
      },
      TODAY
    );
    expect(q.calls).toEqual([]);
  });
});

describe("activeMemberFilterCount", () => {
  it("counts active groups, not selections", () => {
    expect(activeMemberFilterCount(EMPTY_MEMBER_FILTERS)).toBe(0);
    expect(
      activeMemberFilterCount({
        ...EMPTY_MEMBER_FILTERS,
        followUps: ["open"],
      })
    ).toBe(1);
    expect(
      activeMemberFilterCount({
        plans: ["a", "b"],
        statuses: ["active"],
        feeStatus: [],
        churnRisk: [],
        followUps: [],
      })
    ).toBe(2);
  });
});
