'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  Layers,
  Loader2,
  MessageCircle,
  Receipt,
  Repeat,
  Rocket,
  UsersRound,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { BranchSetupReviewCard } from '@/components/branches/branch-setup-review-card';
import type { OnboardingStep, OnboardingStepId } from '@/lib/onboarding/steps';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const STEP_ICONS: Record<OnboardingStepId, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  template: BadgeCheck,
  plan: Layers,
  member: Dumbbell,
  autopay: Repeat,
  payment: Receipt,
  staff: UsersRound,
};

const GROUP_LABELS: { key: OnboardingStep['group']; label: string }[] = [
  { key: 'messaging', label: 'Set up messaging' },
  { key: 'gym', label: 'Run your gym' },
  { key: 'payments', label: 'Collect payments' },
];

function StepRow({ step }: { step: OnboardingStep }) {
  const Icon = STEP_ICONS[step.id];
  return (
    <Link
      href={step.href}
      className={cn(
        'group border-border bg-card flex items-start gap-3.5 rounded-xl border p-4 transition-colors',
        'hover:border-border-hover'
      )}
    >
      {/* Neutral by design: a brand accent here can collide with the
          emerald done-state on the trailing tick. */}
      <span className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-sm font-semibold',
            step.done ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {step.title}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {step.subtitle}
        </span>
      </span>
      {step.done ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : (
        <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      )}
    </Link>
  );
}

export function GetStartedView() {
  const { profileLoading, canEditSettings, account } = useAuth();
  const onboarding = useOnboardingStatus();

  if (profileLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-24">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!canEditSettings) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <BranchSetupReviewCard />
        <Card className="items-center gap-3 px-6 py-8 text-center">
          <span className="bg-primary-soft text-primary-text flex size-11 items-center justify-center rounded-lg">
            <Rocket className="size-5" />
          </span>
          <div className="text-foreground text-base font-semibold">
            Setup is handled by admins
          </div>
          <p className="text-muted-foreground text-sm">
            Ask an admin or the account owner to finish the seven-step setup
            guide and review this branch’s configuration.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Go to dashboard
          </Button>
        </Card>
      </section>
    );
  }

  // Dismissed (or every step auto-completed, which self-dismisses):
  // the sidebar item is gone, but the URL stays reachable.
  const dismissed = account?.onboarding_dismissed_at != null;
  if (dismissed || onboarding.allDone) {
    return (
      <section className="animate-in fade-in-50 mx-auto max-w-3xl space-y-4 duration-200">
        <BranchSetupReviewCard />
        <Card className="items-center gap-3 px-6 py-8 text-center">
          <span className="text-emerald-foreground flex size-11 items-center justify-center rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="size-5" />
          </span>
          <div className="text-foreground text-base font-semibold">
            Core checklist complete
          </div>
          <p className="text-muted-foreground text-sm">
            The seven-step checklist is complete. Review WhatsApp, payments,
            reminders, templates, and other integrations separately before
            relying on them operationally.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Go to dashboard
          </Button>
        </Card>
      </section>
    );
  }

  if (onboarding.loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-24">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const { steps, completedCount, total, recommended } = onboarding;
  const RecommendedIcon = recommended ? STEP_ICONS[recommended.id] : Rocket;

  return (
    <section className="animate-in fade-in-50 mx-auto max-w-3xl duration-200">
      <BranchSetupReviewCard className="mb-4" />

      {/* Progress header */}
      <Card size="sm" className="gap-2 px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground flex items-center gap-2 font-semibold">
            <Rocket className="text-primary-text size-4" /> Setup guide
          </span>
          <span className="text-muted-foreground tabular-nums">
            {completedCount}/{total}
          </span>
        </div>
        <Progress value={completedCount} max={total} />
      </Card>

      {/* Recommended next action */}
      {recommended && (
        <Card className="mt-3 px-5 py-5">
          <div className="text-muted-foreground text-xs font-medium">
            We recommend this action next
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="bg-primary-soft text-primary-text flex size-11 shrink-0 items-center justify-center rounded-lg">
              <RecommendedIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-base font-semibold">
                {recommended.title}
              </div>
              <div className="text-muted-foreground mt-0.5 text-sm">
                {recommended.subtitle}
              </div>
            </div>
            <Button
              nativeButton={false}
              render={<Link href={recommended.href} />}
            >
              Set up <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </Card>
      )}

      {/* Setup actions, grouped */}
      {GROUP_LABELS.map(({ key, label }) => (
        <div key={key} className="mt-5">
          <h2 className="text-foreground px-1 text-sm font-semibold">
            {label}
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {steps
              .filter((step) => step.group === key)
              .map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
          </div>
        </div>
      ))}

      {/* Early opt-out — completion self-dismisses, this is for owners
          who migrated mid-way and don't need the guide. */}
      <div className="mt-6 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => void onboarding.dismiss()}
        >
          Hide this page — I&apos;m already set up
        </Button>
      </div>
    </section>
  );
}
