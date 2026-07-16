// Pure derivation for the Get Started onboarding checklist.
// Components fetch the raw signals (see use-onboarding-status) and this
// module turns them into ordered steps + progress. Keeping it I/O-free
// makes the completion rules unit-testable.

export type OnboardingStepId =
  | "whatsapp"
  | "template"
  | "plan"
  | "member"
  | "payment"
  | "staff";

export type OnboardingStepGroup = "messaging" | "gym";

export interface OnboardingRawStatus {
  whatsappConnected: boolean;
  templateApproved: boolean;
  planCount: number;
  membershipCount: number;
  paidPaymentCount: number;
  /** Team roster size incl. self; null = fetch failed (treated as incomplete). */
  teamSize: number | null;
  /** Pending invitations; null = fetch failed (treated as incomplete). */
  pendingInvites: number | null;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  subtitle: string;
  /** Where the action happens — settings deep-link or page route. */
  href: string;
  group: OnboardingStepGroup;
  done: boolean;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  total: number;
  /**
   * True only when every step is affirmatively complete. A failed
   * fetch (null signal) keeps its step incomplete so we never
   * auto-dismiss onboarding off missing data.
   */
  allDone: boolean;
  /** First incomplete step in order — the "do this next" suggestion. */
  recommended: OnboardingStep | null;
}

interface StepDefinition {
  id: OnboardingStepId;
  title: string;
  subtitle: string;
  href: string;
  group: OnboardingStepGroup;
  isDone: (raw: OnboardingRawStatus) => boolean;
}

const STEP_DEFINITIONS: StepDefinition[] = [
  {
    id: "whatsapp",
    title: "Connect WhatsApp",
    subtitle: "Link your WhatsApp Business number so you can message members",
    href: "/settings?tab=whatsapp",
    group: "messaging",
    isDone: (raw) => raw.whatsappConnected,
  },
  {
    id: "template",
    title: "Approve the renewal reminder template",
    subtitle: "One-tap renewal reminders need Meta's approval once",
    href: "/settings?tab=templates",
    group: "messaging",
    isDone: (raw) => raw.templateApproved,
  },
  {
    id: "plan",
    title: "Create your first membership plan",
    subtitle: "Set up the plans and pricing your gym sells",
    href: "/settings?tab=plans",
    group: "gym",
    isDone: (raw) => raw.planCount > 0,
  },
  {
    id: "member",
    title: "Add your first member",
    subtitle: "Bring your existing members into UsefulDesk",
    href: "/members",
    group: "gym",
    isDone: (raw) => raw.membershipCount > 0,
  },
  {
    id: "payment",
    title: "Record your first payment",
    subtitle: "Log a payment from a member's profile to track collections",
    href: "/members",
    group: "gym",
    isDone: (raw) => raw.paidPaymentCount > 0,
  },
  {
    id: "staff",
    title: "Invite your staff",
    subtitle: "Give trainers and front-desk staff their own access",
    href: "/settings?tab=members",
    group: "gym",
    isDone: (raw) => (raw.teamSize ?? 0) > 1 || (raw.pendingInvites ?? 0) > 0,
  },
];

export const ONBOARDING_STEP_COUNT = STEP_DEFINITIONS.length;

export function deriveOnboardingSteps(
  raw: OnboardingRawStatus,
): OnboardingProgress {
  const steps = STEP_DEFINITIONS.map(({ isDone, ...step }) => ({
    ...step,
    done: isDone(raw),
  }));
  const completedCount = steps.filter((step) => step.done).length;
  return {
    steps,
    completedCount,
    total: steps.length,
    allDone: completedCount === steps.length,
    recommended: steps.find((step) => !step.done) ?? null,
  };
}
