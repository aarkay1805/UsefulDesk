import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ROLES,
  type AccountRole,
  canDeleteAccount,
  canDeleteAnyLead,
  canDeleteAnyNote,
  canDeleteLead,
  canDeleteMember,
  canCorrectPayments,
  canExportFinance,
  canManageMandates,
  canConfigurePaymentGateway,
  canEditSettings,
  canManageMembers,
  canReassignLeadsDirectly,
  canRequestLeadTransfer,
  canResolveAnyLeadTransfer,
  canSendMessages,
  canTransferOwnership,
  canViewOnly,
  hasMinRole,
  isAccountRole,
  roleRank,
} from "./roles";

describe("roleRank", () => {
  it("orders owner > admin > agent > viewer", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("agent"));
    expect(roleRank("agent")).toBeGreaterThan(roleRank("viewer"));
  });

  it("matches the SQL helper's numeric mapping", () => {
    // Keep these in lockstep with `is_account_member`'s CASE expression
    // in supabase/migrations/017_account_sharing.sql — any change here
    // means the SQL helper needs the same change.
    expect(roleRank("owner")).toBe(4);
    expect(roleRank("admin")).toBe(3);
    expect(roleRank("agent")).toBe(2);
    expect(roleRank("viewer")).toBe(1);
  });
});

describe("hasMinRole", () => {
  it("returns true when role meets the threshold", () => {
    expect(hasMinRole("owner", "viewer")).toBe(true);
    expect(hasMinRole("admin", "agent")).toBe(true);
    expect(hasMinRole("agent", "agent")).toBe(true);
  });

  it("returns false when role is below the threshold", () => {
    expect(hasMinRole("viewer", "agent")).toBe(false);
    expect(hasMinRole("agent", "admin")).toBe(false);
    expect(hasMinRole("admin", "owner")).toBe(false);
  });

  // The full matrix — useful as a regression net if anyone reshuffles
  // the rank table.
  it.each<[AccountRole, AccountRole, boolean]>([
    ["owner", "owner", true],
    ["owner", "admin", true],
    ["owner", "agent", true],
    ["owner", "viewer", true],
    ["admin", "owner", false],
    ["admin", "admin", true],
    ["admin", "agent", true],
    ["admin", "viewer", true],
    ["agent", "owner", false],
    ["agent", "admin", false],
    ["agent", "agent", true],
    ["agent", "viewer", true],
    ["viewer", "owner", false],
    ["viewer", "admin", false],
    ["viewer", "agent", false],
    ["viewer", "viewer", true],
  ])("%s vs min %s → %s", (role, min, expected) => {
    expect(hasMinRole(role, min)).toBe(expected);
  });
});

describe("isAccountRole", () => {
  it("accepts every value in ACCOUNT_ROLES", () => {
    for (const role of ACCOUNT_ROLES) {
      expect(isAccountRole(role)).toBe(true);
    }
  });

  it("rejects garbage / case mismatch / non-strings", () => {
    expect(isAccountRole("Owner")).toBe(false);
    expect(isAccountRole("")).toBe(false);
    expect(isAccountRole(null)).toBe(false);
    expect(isAccountRole(undefined)).toBe(false);
    expect(isAccountRole(123)).toBe(false);
    expect(isAccountRole("superuser")).toBe(false);
  });
});

describe("capability predicates", () => {
  it("canManageMembers: admin+ only", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("agent")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
  });

  it("canEditSettings: admin+ only", () => {
    expect(canEditSettings("owner")).toBe(true);
    expect(canEditSettings("admin")).toBe(true);
    expect(canEditSettings("agent")).toBe(false);
    expect(canEditSettings("viewer")).toBe(false);
  });

  it("canSendMessages: agent+ only", () => {
    expect(canSendMessages("owner")).toBe(true);
    expect(canSendMessages("admin")).toBe(true);
    expect(canSendMessages("agent")).toBe(true);
    expect(canSendMessages("viewer")).toBe(false);
  });

  it("canCorrectPayments: admin+ only", () => {
    expect(canCorrectPayments("owner")).toBe(true);
    expect(canCorrectPayments("admin")).toBe(true);
    expect(canCorrectPayments("agent")).toBe(false);
    expect(canCorrectPayments("viewer")).toBe(false);
  });

  it("canExportFinance: admin+ only", () => {
    expect(canExportFinance("owner")).toBe(true);
    expect(canExportFinance("admin")).toBe(true);
    expect(canExportFinance("agent")).toBe(false);
    expect(canExportFinance("viewer")).toBe(false);
  });

  it("canManageMandates: agent+ (set up / pause auto-debit)", () => {
    expect(canManageMandates("owner")).toBe(true);
    expect(canManageMandates("admin")).toBe(true);
    expect(canManageMandates("agent")).toBe(true);
    expect(canManageMandates("viewer")).toBe(false);
  });

  it("canConfigurePaymentGateway: admin+ (creds / cancel mandate)", () => {
    expect(canConfigurePaymentGateway("owner")).toBe(true);
    expect(canConfigurePaymentGateway("admin")).toBe(true);
    expect(canConfigurePaymentGateway("agent")).toBe(false);
    expect(canConfigurePaymentGateway("viewer")).toBe(false);
  });

  it("canViewOnly: viewer only", () => {
    expect(canViewOnly("owner")).toBe(false);
    expect(canViewOnly("admin")).toBe(false);
    expect(canViewOnly("agent")).toBe(false);
    expect(canViewOnly("viewer")).toBe(true);
  });

  it("canDeleteAnyNote: admin+ only", () => {
    expect(canDeleteAnyNote("owner")).toBe(true);
    expect(canDeleteAnyNote("admin")).toBe(true);
    expect(canDeleteAnyNote("agent")).toBe(false);
    expect(canDeleteAnyNote("viewer")).toBe(false);
  });

  it("canReassignLeadsDirectly: admin+ only", () => {
    expect(canReassignLeadsDirectly("owner")).toBe(true);
    expect(canReassignLeadsDirectly("admin")).toBe(true);
    expect(canReassignLeadsDirectly("agent")).toBe(false);
    expect(canReassignLeadsDirectly("viewer")).toBe(false);
  });

  it("canRequestLeadTransfer: agent+ only", () => {
    expect(canRequestLeadTransfer("owner")).toBe(true);
    expect(canRequestLeadTransfer("admin")).toBe(true);
    expect(canRequestLeadTransfer("agent")).toBe(true);
    expect(canRequestLeadTransfer("viewer")).toBe(false);
  });

  it("canResolveAnyLeadTransfer: admin+ only", () => {
    expect(canResolveAnyLeadTransfer("owner")).toBe(true);
    expect(canResolveAnyLeadTransfer("admin")).toBe(true);
    expect(canResolveAnyLeadTransfer("agent")).toBe(false);
    expect(canResolveAnyLeadTransfer("viewer")).toBe(false);
  });

  it("canDeleteAnyLead: admin+ only", () => {
    expect(canDeleteAnyLead("owner")).toBe(true);
    expect(canDeleteAnyLead("admin")).toBe(true);
    expect(canDeleteAnyLead("agent")).toBe(false);
    expect(canDeleteAnyLead("viewer")).toBe(false);
  });

  describe("canDeleteLead (per-lead)", () => {
    const ME = "user-me";
    const OTHER = "user-other";

    it("admin/owner delete any lead — incl. auto-captured and others'", () => {
      for (const role of ["owner", "admin"] as const) {
        expect(
          canDeleteLead(role, { createdBy: OTHER, userId: ME, receivedVia: "meta" }),
        ).toBe(true);
        expect(
          canDeleteLead(role, { createdBy: null, userId: ME, receivedVia: "whatsapp" }),
        ).toBe(true);
      }
    });

    it("agent deletes only a human-origin lead they created", () => {
      // own + manual → yes
      expect(
        canDeleteLead("agent", { createdBy: ME, userId: ME, receivedVia: "manual" }),
      ).toBe(true);
      // own + import → yes
      expect(
        canDeleteLead("agent", { createdBy: ME, userId: ME, receivedVia: "import" }),
      ).toBe(true);
      // own + NULL origin (treated as human) → yes
      expect(
        canDeleteLead("agent", { createdBy: ME, userId: ME, receivedVia: null }),
      ).toBe(true);
    });

    it("agent CANNOT delete auto-captured leads even if created_by is them", () => {
      for (const via of ["whatsapp", "meta", "api", "automation", "form"] as const) {
        expect(
          canDeleteLead("agent", { createdBy: ME, userId: ME, receivedVia: via }),
        ).toBe(false);
      }
    });

    it("agent CANNOT delete a teammate's lead", () => {
      expect(
        canDeleteLead("agent", { createdBy: OTHER, userId: ME, receivedVia: "manual" }),
      ).toBe(false);
      // no recorded creator → not theirs
      expect(
        canDeleteLead("agent", { createdBy: null, userId: ME, receivedVia: "manual" }),
      ).toBe(false);
    });

    it("viewer can never delete", () => {
      expect(
        canDeleteLead("viewer", { createdBy: ME, userId: ME, receivedVia: "manual" }),
      ).toBe(false);
    });
  });

  it("canDeleteMember: admin+ only", () => {
    expect(canDeleteMember("owner")).toBe(true);
    expect(canDeleteMember("admin")).toBe(true);
    expect(canDeleteMember("agent")).toBe(false);
    expect(canDeleteMember("viewer")).toBe(false);
  });

  it("canDeleteAccount: owner only", () => {
    expect(canDeleteAccount("owner")).toBe(true);
    expect(canDeleteAccount("admin")).toBe(false);
    expect(canDeleteAccount("agent")).toBe(false);
    expect(canDeleteAccount("viewer")).toBe(false);
  });

  it("canTransferOwnership: owner only", () => {
    expect(canTransferOwnership("owner")).toBe(true);
    expect(canTransferOwnership("admin")).toBe(false);
    expect(canTransferOwnership("agent")).toBe(false);
    expect(canTransferOwnership("viewer")).toBe(false);
  });
});
