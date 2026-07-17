import { describe, expect, it } from "vitest";

import {
  deriveOnboardingSteps,
  ONBOARDING_STEP_COUNT,
  type OnboardingRawStatus,
} from "./steps";

const nothingDone: OnboardingRawStatus = {
  whatsappConnected: false,
  templateApproved: false,
  planCount: 0,
  membershipCount: 0,
  razorpayConnected: false,
  paidPaymentCount: 0,
  teamSize: 1,
  pendingInvites: 0,
};

const everythingDone: OnboardingRawStatus = {
  whatsappConnected: true,
  templateApproved: true,
  planCount: 3,
  membershipCount: 12,
  razorpayConnected: true,
  paidPaymentCount: 5,
  teamSize: 2,
  pendingInvites: 0,
};

describe("deriveOnboardingSteps", () => {
  it("reports 0 complete and recommends WhatsApp first on a fresh account", () => {
    const result = deriveOnboardingSteps(nothingDone);
    expect(result.completedCount).toBe(0);
    expect(result.total).toBe(ONBOARDING_STEP_COUNT);
    expect(result.allDone).toBe(false);
    expect(result.recommended?.id).toBe("whatsapp");
  });

  it("recommends the first incomplete step in definition order", () => {
    const result = deriveOnboardingSteps({
      ...nothingDone,
      whatsappConnected: true,
    });
    expect(result.completedCount).toBe(1);
    expect(result.recommended?.id).toBe("template");
  });

  it("skips completed steps when recommending, even out of order", () => {
    const result = deriveOnboardingSteps({
      ...nothingDone,
      whatsappConnected: true,
      templateApproved: true,
      membershipCount: 4,
    });
    expect(result.recommended?.id).toBe("plan");
  });

  it("marks all done with no recommendation when every step completes", () => {
    const result = deriveOnboardingSteps(everythingDone);
    expect(result.completedCount).toBe(ONBOARDING_STEP_COUNT);
    expect(result.allDone).toBe(true);
    expect(result.recommended).toBeNull();
  });

  it("groups Razorpay setup before the first payment", () => {
    const paymentSteps = deriveOnboardingSteps(nothingDone).steps.filter(
      (step) => step.group === "payments",
    );

    expect(paymentSteps.map((step) => step.id)).toEqual(["autopay", "payment"]);
    expect(paymentSteps[0]?.done).toBe(false);
    expect(
      deriveOnboardingSteps({
        ...nothingDone,
        razorpayConnected: true,
      }).steps.find((step) => step.id === "autopay")?.done,
    ).toBe(true);
  });

  describe("staff step", () => {
    const staffStep = (raw: OnboardingRawStatus) =>
      deriveOnboardingSteps(raw).steps.find((step) => step.id === "staff")!;

    it("is done when the roster has more than just the owner", () => {
      expect(staffStep({ ...nothingDone, teamSize: 2 }).done).toBe(true);
    });

    it("is done when an invite is pending even with a solo roster", () => {
      expect(
        staffStep({ ...nothingDone, teamSize: 1, pendingInvites: 1 }).done,
      ).toBe(true);
    });

    it("is not done for a solo roster with no invites", () => {
      expect(staffStep(nothingDone).done).toBe(false);
    });

    it("treats failed fetches (nulls) as incomplete so allDone can never come from missing data", () => {
      const result = deriveOnboardingSteps({
        ...everythingDone,
        teamSize: null,
        pendingInvites: null,
      });
      expect(result.steps.find((step) => step.id === "staff")?.done).toBe(
        false,
      );
      expect(result.allDone).toBe(false);
    });
  });
});
