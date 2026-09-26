'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

import { invalidateApprovedMessageTemplates } from '@/components/inbox/use-approved-message-templates';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';
import { getErrorMessage } from '@/lib/errors';
import type { RequiredTemplateSubmissionSummary } from '@/lib/whatsapp/required-template-submission';
import { cn } from '@/lib/utils';
import { SettingsSectionHead } from './settings-panel-head';

/** Readiness codes the one-click submission can resolve: it creates missing
 *  and draft templates and edits rejected, paused, or outdated ones. */
export const SUBMITTABLE_READINESS_CODES = new Set([
  'missing',
  'not_approved',
  'rejected',
  'paused',
  'component_drift',
  'parameter_drift',
  'wrong_parameter_format',
]);

/** How long Meta takes, said once so every surface promises the same thing. */
export const WHATSAPP_REVIEW_TIME =
  'WhatsApp usually reviews a message within minutes, sometimes up to 24 hours.';

/** The same promise, short enough to follow a sentence that already names
 *  WhatsApp review. */
const REVIEW_TIME = 'It usually takes minutes, up to 24 hours.';

type SetupRule = {
  id: string;
  settings: Record<string, unknown>;
  readiness: { ready: boolean; code: string };
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A step's leading mark. Emerald means done and nothing else, as on the
 *  Get started guide; an open step stays neutral. */
function StepMarker({ index, done }: { index: number; done: boolean }) {
  return done ? (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
      <Check className="size-3.5" strokeWidth={3} aria-hidden />
      <span className="sr-only">Done:</span>
    </span>
  ) : (
    <span
      className="bg-muted text-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums"
      aria-hidden
    >
      {index}
    </span>
  );
}

/** One step of the setup strip: a marker, a name, and an optional count.
 *  Only the current step is set in the foreground colour. */
function SetupStep({
  index,
  done,
  current,
  title,
  count,
}: {
  index: number;
  done: boolean;
  current: boolean;
  title: string;
  count?: string;
}) {
  return (
    <li
      className="flex items-center gap-2"
      aria-current={current ? 'step' : undefined}
    >
      <StepMarker index={index} done={done} />
      <span
        className={cn(
          'text-sm',
          current ? 'text-foreground font-medium' : 'text-muted-foreground'
        )}
      >
        {title}
        {count ? (
          <span className="text-muted-foreground font-normal tabular-nums">
            {' '}
            · {count}
          </span>
        ) : null}
      </span>
    </li>
  );
}

const APPROVAL_STEPS = [
  { title: 'Send for review', caption: 'You send it once.' },
  {
    title: 'WhatsApp reviews it',
    caption: 'Usually minutes, up to 24 hours.',
  },
  {
    title: 'Turn it on',
    caption: 'Use its switch in Automated messages.',
  },
] as const;

/**
 * Where one message is in WhatsApp's approval path. Set-up dialogs show it
 * so "send for review" reads as step one of three, not the end.
 */
export function ApprovalSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label="How a message gets approved"
      className="grid gap-3 sm:grid-cols-3"
    >
      {APPROVAL_STEPS.map((step, offset) => {
        const index = offset + 1;
        const done = index < current;
        return (
          <li
            key={step.title}
            className="flex items-start gap-2"
            aria-current={index === current ? 'step' : undefined}
          >
            <StepMarker index={index} done={done} />
            <div className="min-w-0 space-y-0.5">
              <div
                className={cn(
                  'text-sm',
                  index === current
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {step.title}
              </div>
              <div className="text-muted-foreground text-xs">
                {step.caption}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The "am I set up?" answer for Automated messages: three steps in the
 * order WhatsApp imposes them — connect, get approved, turn on — on one
 * line, with the one action that moves the current step and one sentence
 * about it. It stays a strip so the messages themselves start above the
 * fold. Sending every required message for review is one click here
 * instead of one dialog per message.
 */
export function AutomatedMessageSetup({
  rules,
  canEdit,
  blocker,
  connectHref,
  accountId,
  onChanged,
}: {
  rules: readonly SetupRule[];
  canEdit: boolean;
  blocker: ActionBlocker;
  connectHref: string;
  accountId: string | null;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const total = rules.length;
  const readyCount = rules.filter((rule) => rule.readiness.ready).length;
  const connected = !rules.some(
    (rule) => rule.readiness.code === 'whatsapp_not_connected'
  );
  const needsReview = rules.filter((rule) =>
    SUBMITTABLE_READINESS_CODES.has(rule.readiness.code)
  ).length;
  const inReview = rules.filter(
    (rule) => rule.readiness.code === 'pending'
  ).length;
  const needsAttention = total - readyCount - needsReview - inReview;
  const enabledCount = rules.filter(
    (rule) => rule.settings.enabled === true && rule.readiness.ready
  ).length;

  const syncFromWhatsApp = async () => {
    const response = await fetch('/api/whatsapp/templates/sync', {
      method: 'POST',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(data?.error || 'We could not check WhatsApp.');
    if (accountId) invalidateApprovedMessageTemplates(accountId);
  };

  const sendAllForReview = async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/whatsapp/templates/submit-required', {
        method: 'POST',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error || 'Messages could not be sent for review. Try again.'
        );
      const summary = data as RequiredTemplateSubmissionSummary;
      if (summary.failed > 0) {
        toast.error(
          `Sent ${summary.submitted} for review. ${plural(summary.failed, 'message')} need help — open ${summary.failed === 1 ? 'it' : 'them'} below.`,
          { duration: 10000 }
        );
      } else if (summary.submitted > 0) {
        toast.success(
          `Sent ${plural(summary.submitted, 'message')} for WhatsApp review. ${WHATSAPP_REVIEW_TIME}`
        );
      } else {
        toast.success('Every message is approved or waiting for review.');
      }
      try {
        await syncFromWhatsApp();
      } catch (syncError) {
        toast.error(
          getErrorMessage(syncError, 'We could not check the latest status.')
        );
      }
      onChanged();
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Messages could not be sent for review.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const checkStatus = async () => {
    setChecking(true);
    try {
      await syncFromWhatsApp();
      toast.success('WhatsApp status checked');
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, 'We could not check WhatsApp.'));
    } finally {
      setChecking(false);
    }
  };

  const editBlocker = canEdit ? null : blocker;
  const connectAction = connected ? null : canEdit ? (
    <Button size="sm" nativeButton={false} render={<Link href={connectHref} />}>
      Connect WhatsApp
    </Button>
  ) : (
    <ResolvableAction
      blocker={blocker}
      trigger={<Button size="sm">Connect WhatsApp</Button>}
    />
  );

  const reviewAction = !connected ? null : needsReview > 0 ? (
    <ResolvableAction
      blocker={editBlocker}
      onAction={sendAllForReview}
      trigger={
        <Button size="sm" loading={submitting}>
          Send {plural(needsReview, 'message')} for review
        </Button>
      }
    />
  ) : inReview > 0 ? (
    <ResolvableAction
      blocker={editBlocker}
      onAction={checkStatus}
      trigger={
        <Button size="sm" variant="outline" loading={checking}>
          Check status
        </Button>
      }
    />
  ) : null;

  // One sentence about the current step, in the same words as the row
  // badges below (Not sent for review, In WhatsApp review).
  const turnOnNote =
    enabledCount > 0 ? '' : ' Nothing sends until you turn it on below.';
  const statusDescription = !connected
    ? 'Automated messages send from your WhatsApp Business number. Connect it to send them for review.'
    : needsReview > 0
      ? `${plural(needsReview, 'message')} ${needsReview === 1 ? 'is' : 'are'} not sent for review yet${inReview > 0 ? `; ${inReview} ${inReview === 1 ? 'is' : 'are'} in WhatsApp review` : ''}. ${REVIEW_TIME}`
      : inReview > 0
        ? `${plural(inReview, 'message')} ${inReview === 1 ? 'is' : 'are'} in WhatsApp review. ${REVIEW_TIME}${turnOnNote}`
        : `${plural(needsAttention, 'message')} ${needsAttention === 1 ? 'needs' : 'need'} attention — ${needsAttention === 1 ? 'its row says' : 'their rows say'} what to fix.${turnOnNote}`;

  return (
    <section aria-labelledby="automated-message-setup" className="space-y-3">
      <SettingsSectionHead
        id="automated-message-setup"
        title="Get ready to send"
      />
      <Card size="sm">
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <ol
              aria-label="Setup steps"
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
            >
              <SetupStep
                index={1}
                done={connected}
                current={!connected}
                title={connected ? 'WhatsApp connected' : 'Connect WhatsApp'}
              />
              <SetupStep
                index={2}
                done={connected && readyCount === total}
                current={connected && readyCount < total}
                title="Get approved"
                count={`${readyCount} of ${total} ready`}
              />
              <SetupStep
                index={3}
                done={enabledCount > 0}
                current={false}
                title={
                  enabledCount > 0
                    ? `${enabledCount} turned on`
                    : 'Turn messages on'
                }
              />
            </ol>
            {connectAction ?? reviewAction}
          </div>
          <p className="text-muted-foreground text-sm text-pretty">
            {statusDescription}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
