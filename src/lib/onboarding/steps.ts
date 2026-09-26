// Pure derivation for the Get Started onboarding checklist.
// Components fetch the raw signals (see use-onboarding-status) and this
// module turns them into ordered steps + progress. Keeping it I/O-free
// makes the completion rules unit-testable.

export type OnboardingStepId =
  'whatsapp' | 'template' | 'plan' | 'member' | 'autopay' | 'payment' | 'staff';

export type OnboardingStepGroup = 'messaging' | 'gym' | 'payments';

export interface OnboardingRawStatus {
  whatsappConnected: boolean;
  templateApproved: boolean;
  /** Exact setup-completion prerequisite: an active plan with active pricing. */
  hasActivePlanPricing: boolean;
  membershipCount: number;
  razorpayConnected: boolean;
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
    id: 'whatsapp',
    title: 'Connect WhatsApp',
    subtitle: 'Add your gym\'s WhatsApp Business number so you can message members',
    href: '/settings?tab=whatsapp',
    group: 'messaging',
    isDone: (raw) => raw.whatsappConnected,
  },
  {
    id: 'template',
    title: 'Get your renewal message approved',
    subtitle:
      'Send the renewal reminder message to WhatsApp for approval. WhatsApp may say no.',
    href: '/settings?tab=templates',
    group: 'messaging',
    isDone: (raw) => raw.templateApproved,
  },
  {
    id: 'plan',
    title: 'Create your first membership plan',
    subtitle: 'Add the plans and prices your gym sells',
    href: '/settings?tab=plans',
    group: 'gym',
    isDone: (raw) => raw.hasActivePlanPricing,
  },
  {
    id: 'member',
    title: 'Add your first member',
    subtitle: 'Add your current members, one by one or from an Excel file',
    href: '/members',
    group: 'gym',
    isDone: (raw) => raw.membershipCount > 0,
  },
  {
    id: 'staff',
    title: 'Invite your staff',
    subtitle: 'Give trainers and front-desk staff their own login',
    href: '/settings?tab=members',
    group: 'gym',
    isDone: (raw) => (raw.teamSize ?? 0) > 1 || (raw.pendingInvites ?? 0) > 0,
  },
  {
    id: 'autopay',
    title: 'Set up AutoPay for members',
    subtitle:
      'Connect Razorpay so member fees are collected automatically every month',
    href: '/settings?tab=deals',
    group: 'payments',
    isDone: (raw) => raw.razorpayConnected,
  },
  {
    id: 'payment',
    title: 'Record your first payment',
    subtitle: "Open a member and record a fee they paid",
    href: '/members',
    group: 'payments',
    isDone: (raw) => raw.paidPaymentCount > 0,
  },
];

export const ONBOARDING_STEP_COUNT = STEP_DEFINITIONS.length;

export function deriveOnboardingSteps(
  raw: OnboardingRawStatus
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
