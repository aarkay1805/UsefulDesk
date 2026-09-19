'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { AutomatedMessageActivity } from '@/components/settings/automated-message-activity';
import { BubbleTail } from '@/components/inbox/message-bubble';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapse } from '@/components/ui/collapse';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import {
  BRANCH_HEADER,
  browserBranchId,
  branchHref,
} from '@/lib/auth/branch-context';
import { getErrorMessage } from '@/lib/errors';
import { timeInTzToUtc } from '@/lib/locale/format';
import {
  REMINDER_RULE_GROUP_LABELS,
  REMINDER_RULE_GROUPS,
  REMINDER_RULES,
  type ReminderRule,
  type ReminderRuleId,
  type ReminderRulePatch,
} from '@/lib/reminders/rules';
import {
  getTemplateContractById,
  type TemplateContractId,
} from '@/lib/whatsapp/template-contracts';
import { TemplateManager } from './template-manager';
import { useLocale } from '@/hooks/use-locale';
import { SettingsPanelHead, SettingsSectionHead } from './settings-panel-head';

/** The line-tab recipe the app bar uses on Members, on the documented type
 *  ramp. The panel's own divider stands in for the app bar's. */
const TAB_TRIGGER_CLASS =
  'flex-none px-0.5 pb-2 text-sm group-data-horizontal/tabs:after:bottom-0';

/** How long a rule row takes to open or close. */
const ROW_COLLAPSE_SECONDS = 0.28;

/**
 * A request to scroll the open rule into view once it has rendered. Every
 * group is on one page, so a rule opened from elsewhere can be far below.
 */
type RuleReveal = {
  /** Opened from another control (Review rule, Change sending hours): focus
   *  moves to the rule and the scroll animates. A reload only restores the
   *  position. */
  navigate: boolean;
  /** The previously open row is still closing and can move this one. */
  afterCollapse: boolean;
};

// Every member can read the rules. For anyone without settings access,
// permission is the first blocker on each change action, so pressing one
// explains why instead of opening a flow they cannot finish.
const EDIT_PERMISSION_BLOCKER: ActionBlocker = {
  title: 'Admin access required',
  description: 'Only an admin or owner can change automated messages.',
};

type RuleRow = ReminderRule & {
  settings: Record<string, unknown>;
  readiness: {
    ready: boolean;
    code: string;
    message?: string;
    templateContractId?: (typeof REMINDER_RULES)[number]['templateContracts'][number];
  };
};

const LIFECYCLE_RULE_IDS = new Set<ReminderRuleId>([
  'invoice_collection',
  'promise_to_pay',
  'payment_link_follow_up',
  'membership_post_expiry',
  'service_post_expiry',
  'session_pack',
  'freeze_return',
  'membership_win_back',
  'service_win_back',
]);

const RULE_DETAILS: Record<
  ReminderRuleId,
  {
    meaning: string;
    timing: string;
    eligibility: string;
    stops: string;
    staff: string;
  }
> = {
  membership_renewal: {
    meaning: 'Reminds a member before their current membership ends.',
    timing: 'Before a current membership ends.',
    eligibility:
      'Manually renewed, recurring active memberships with an upcoming end date and a member phone number.',
    stops: 'The membership is renewed, cancelled, or its end date changes.',
    staff: 'Handle renewal replies and follow up with members who need help.',
  },
  service_renewal: {
    meaning:
      'Reminds a member before a paid service, such as personal training, ends.',
    timing: 'Before a current paid service ends.',
    eligibility:
      'Current services with an upcoming end date, current price, and a member phone number.',
    stops:
      'The service is renewed, cancelled, archived, or its end date changes.',
    staff: 'Handle service renewal replies and pricing questions.',
  },
  membership_post_expiry: {
    meaning: 'Follows up after a membership ends and has not been renewed.',
    timing: 'On days 1, 3, and 7 after membership expiry.',
    eligibility: 'Expired memberships that have not changed since expiry.',
    stops:
      'The membership renews, is held, frozen, replaced, or the member replies.',
    staff:
      'An accepted day-7 reminder creates or links one branch-owner follow-up when there is no reply.',
  },
  service_post_expiry: {
    meaning: 'Follows up after a paid service ends and has not been renewed.',
    timing: 'On days 1, 3, and 7 after service expiry.',
    eligibility: 'Expired paid services that have not changed since expiry.',
    stops: 'The service renews, is held, replaced, or the member replies.',
    staff:
      'An accepted day-7 reminder creates or links one branch-owner follow-up when there is no reply.',
  },
  invoice_collection: {
    meaning:
      'Reminds a member before an invoice is due and again while money is still unpaid.',
    timing: 'Before due dates and on opted-in overdue milestones.',
    eligibility:
      'Open invoices with a due amount and a member phone number. Invoices without a due date use their issued date for both due and overdue milestones.',
    stops: 'The invoice is paid, voided, or its balance and due state change.',
    staff:
      'Resolve payment questions and record payments received outside the system.',
  },
  joining_installments: {
    meaning:
      'Reminds a member when part of their joining payment is due. Their payment plan sets the dates.',
    timing: '7, 3, and 1 days before, and on the payment due date.',
    eligibility:
      'A membership transaction with an unpaid installment and a member phone number.',
    stops:
      'The installment is paid, cancelled, or the transaction schedule changes.',
    staff:
      'Follow up on unpaid installments and update the transaction when payment arrives.',
  },
  promise_to_pay: {
    meaning: 'Reminds a member about the date they promised to make a payment.',
    timing: '1 day before, on the due date, and 1 day after.',
    eligibility:
      'An open payment commitment with a due date and member phone number.',
    stops: 'The promise is fulfilled, cancelled, or its due date changes.',
    staff: 'Contact members whose promise has passed without payment.',
  },
  payment_link_follow_up: {
    meaning:
      'Follows up after a payment link was sent but the payment is not complete.',
    timing: '1 and 3 days after the payment link was sent.',
    eligibility: 'An active unpaid payment link with a member phone number.',
    stops: 'The payment link is paid, expired, cancelled, or replaced.',
    staff: 'Resolve failed payment attempts or issue a new link.',
  },
  autopay_recovery: {
    meaning:
      'Tells a member when an AutoPay payment needs another try or has failed.',
    timing: 'When AutoPay will try again or has stopped trying.',
    eligibility:
      'An AutoPay collection event with a matching member phone number.',
    stops:
      'A successful collection, a healthy mandate, or a changed provider outcome.',
    staff:
      'Review terminal failures and help the member choose the next payment step.',
  },
  session_pack: {
    meaning:
      'Warns a member when only a few sessions are left or the pack is empty.',
    timing: 'At 2 or fewer sessions remaining, and again at 0.',
    eligibility:
      'A current session pack with 2 or fewer sessions remaining, including 0.',
    stops: 'The member buys a new pack or the current pack balance changes.',
    staff: 'Reply with suitable pack options when the member asks.',
  },
  freeze_return: {
    meaning:
      'Reminds a member before they plan to return from a frozen membership.',
    timing:
      'One day before the planned return; staff follow-up is due on the return day.',
    eligibility: 'A frozen membership with an unchanged planned return date.',
    stops:
      'The membership returns, stays frozen with a new date, or is cancelled.',
    staff: 'Confirm the member’s next step before the planned return.',
  },
  membership_win_back: {
    meaning:
      'Invites a former member to renew after their membership has been expired for some time.',
    timing: '14, 30, and 60 days after expiry, after the first follow-ups end.',
    eligibility:
      'An unchanged expired membership that reaches the win-back milestone.',
    stops: 'A renewal, replacement cycle, hold, freeze, promise, or reply.',
    staff:
      'Handle replies manually; use current pricing without inventing offers.',
  },
  service_win_back: {
    meaning:
      'Invites a former member to buy a paid service again after it has been expired for some time.',
    timing: '14, 30, and 60 days after expiry, after the first follow-ups end.',
    eligibility:
      'An unchanged expired paid service that reaches the win-back milestone.',
    stops: 'A renewal, replacement service, hold, promise, or reply.',
    staff: 'Handle replies using the current service price.',
  },
  payment_confirmation: {
    meaning: 'Sends a receipt after a payment is recorded as complete.',
    timing:
      'After a completed payment is recorded. Older payments are not included.',
    eligibility: 'A completed payment with a member phone number.',
    stops:
      'The payment is reversed or no longer qualifies for a receipt notification.',
    staff: 'Investigate receipt questions or payment reversals.',
  },
};

function isEnabled(rule: RuleRow) {
  return rule.settings.enabled === true;
}

function timingSummary(rule: RuleRow) {
  if (rule.id === 'invoice_collection') {
    const before = rule.settings.beforeDueDays;
    const overdue = rule.settings.overdueDays;
    const dueText = Array.isArray(before)
      ? before
          .map((day) => (day === 0 ? 'due date' : `${day}d before due`))
          .join(', ')
      : '';
    const overdueText = Array.isArray(overdue)
      ? overdue.map((day) => `${day}d overdue`).join(', ')
      : '';
    return (
      [dueText, overdueText].filter(Boolean).join(' · ') || 'Due and overdue'
    );
  }
  const schedule = rule.fields.find((field) => field.type === 'integer-array');
  if (schedule && Array.isArray(rule.settings[schedule.key])) {
    const values = rule.settings[schedule.key] as number[];
    if (!values.length) return 'No days selected';
    return values
      .map((day) => (day === 0 ? 'Expiry day' : `${day}d before expiry`))
      .join(', ');
  }
  return RULE_DETAILS[rule.id].timing;
}

function ruleHref(
  rule: RuleRow,
  contractId = rule.readiness.templateContractId ?? rule.templateContracts[0]
) {
  const branchId = browserBranchId();
  const returnParams = new URLSearchParams({ tab: 'reminders', rule: rule.id });
  if (branchId) returnParams.set('branch', branchId);
  const params = new URLSearchParams({
    tab: 'templates',
    rule: rule.id,
    returnTo: `/settings?${returnParams.toString()}`,
  });
  if (contractId) params.set('contract', contractId);
  if (branchId) params.set('branch', branchId);
  return `/settings?${params.toString()}`;
}

function setupHref(rule: RuleRow) {
  const branchId = browserBranchId();
  if (rule.readiness.code === 'whatsapp_not_connected') {
    return branchId
      ? `/settings?tab=whatsapp&branch=${branchId}`
      : '/settings?tab=whatsapp';
  }
  return ruleHref(rule);
}

function previewValue(label: string, fmt: ReturnType<typeof useLocale>['fmt']) {
  const value = label.toLowerCase();
  if (value.includes('date')) return fmt.date('2026-09-20');
  if (value.includes('price') || value.includes('amount'))
    return fmt.money(3999);
  if (value.includes('session')) return '2';
  if (value.includes('service')) return 'Personal Training';
  if (value.includes('plan')) return 'Quarterly';
  return 'Rahul';
}

function timingFields(rule: RuleRow) {
  return rule.fields.filter(
    (field) => field.key !== 'enabled' && field.type !== 'boolean'
  );
}

function timingChipLabel(fieldKey: string, day: number) {
  if (day === 0) {
    return fieldKey === 'daysBefore' ? 'On the day' : 'On the due date';
  }
  const days = `${day} day${day === 1 ? '' : 's'}`;
  if (fieldKey === 'overdueDays') return `${days} overdue`;
  if (fieldKey === 'beforeDueDays') return `${days} before due`;
  return `${days} before`;
}

function timingGroupLabel(fieldKey: string) {
  return fieldKey === 'overdueDays'
    ? 'After payment is due'
    : 'Before payment is due';
}

function lateSendLabel(days: number) {
  if (days === 0) return 'the same day';
  return `${days} day${days === 1 ? '' : 's'}`;
}

function numberList(values: number[]) {
  if (values.length < 2) return String(values[0] ?? '');
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function joinPhrases(parts: string[]) {
  if (parts.length < 2) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

function dayPhrase(values: number[]) {
  return `${numberList(values)} ${values.length === 1 && values[0] === 1 ? 'day' : 'days'}`;
}

function reminderScheduleText(
  rule: RuleRow,
  beforeValues: number[],
  afterValues: number[]
) {
  const before = [...beforeValues]
    .filter((day) => day > 0)
    .sort((a, b) => b - a);
  const after = [...afterValues].filter((day) => day > 0).sort((a, b) => a - b);
  const onDate = beforeValues.includes(0);
  const event =
    rule.id === 'invoice_collection'
      ? 'payment is due'
      : rule.id === 'service_renewal'
        ? 'the service ends'
        : 'the membership ends';
  const date =
    rule.id === 'invoice_collection' ? 'on the due date' : 'on the end date';
  const parts = [
    ...(before.length ? [`${dayPhrase(before)} before ${event}`] : []),
    ...(onDate ? [date] : []),
    ...(after.length ? [`${dayPhrase(after)} after ${event}`] : []),
  ];
  if (!parts.length) return 'No reminders are set.';
  const count = before.length + after.length + (onDate ? 1 : 0);
  return `Members get ${count === 1 ? 'a reminder' : 'reminders'} ${joinPhrases(parts)}.`;
}

function previewTabLabel(contractId: TemplateContractId) {
  if (contractId === 'invoice_due') return 'Before or on due date';
  if (contractId === 'invoice_overdue') return 'After due date';
  return getTemplateContractById(contractId)?.title ?? 'Message';
}

// An open rule's settings are the row's children: a nested tile under the
// rule title, with 12px muted captions naming each group so nothing inside
// out-ranks the 14px medium title it belongs to.
const DETAIL_CAPTION = 'text-muted-foreground text-xs font-medium';

type TimingField = RuleRow['fields'][number];

function currentTimingValue(
  rule: RuleRow,
  draft: ReminderRulePatch,
  field: TimingField
) {
  return draft[field.key] ?? rule.settings[field.key] ?? field.defaultValue;
}

function hasDeliveryFields(rule: RuleRow) {
  const keys = timingFields(rule).map((field) => field.key);
  return (
    keys.includes('catchUpDays') ||
    (keys.includes('sendWindowStart') && keys.includes('sendWindowEnd'))
  );
}

function DeliveryControls({
  rule,
  draft,
  onChange,
  disabled,
  formatTime,
}: {
  rule: RuleRow;
  draft: ReminderRulePatch;
  onChange: (patch: ReminderRulePatch) => void;
  disabled: boolean;
  formatTime: (hour: number, minute?: string) => string;
}) {
  const controls = timingFields(rule);
  const catchUpControl = controls.find((field) => field.key === 'catchUpDays');
  const windowStartControl = controls.find(
    (field) => field.key === 'sendWindowStart'
  );
  const windowEndControl = controls.find(
    (field) => field.key === 'sendWindowEnd'
  );
  const windowStart = windowStartControl
    ? Number(currentTimingValue(rule, draft, windowStartControl))
    : null;
  const windowEnd = windowEndControl
    ? Number(currentTimingValue(rule, draft, windowEndControl))
    : null;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return (
    <div className="space-y-3">
      {catchUpControl ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            If UsefulDesk cannot send on time, it can still send within
          </span>
          <Select
            value={String(
              Number(currentTimingValue(rule, draft, catchUpControl))
            )}
            onValueChange={(value) => {
              if (value == null) return;
              onChange({
                ...draft,
                [catchUpControl.key]: Number(value),
              });
            }}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="min-w-28"
              aria-label={`${rule.title} delayed reminder setting`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from(
                { length: (catchUpControl.max ?? 14) + 1 },
                (_, days) => (
                  <SelectItem key={days} value={String(days)}>
                    {lateSendLabel(days)}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {windowStartControl &&
      windowEndControl &&
      windowStart !== null &&
      windowEnd !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Send messages from</span>
          <Select
            value={String(windowStart)}
            onValueChange={(value) => {
              if (value == null) return;
              onChange({
                ...draft,
                [windowStartControl.key]: Number(value),
              });
            }}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="min-w-28"
              aria-label={`${rule.title} start sending at`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hours
                .filter((hour) => hour <= windowEnd)
                .map((hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {formatTime(hour)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span>to</span>
          <Select
            value={String(windowEnd)}
            onValueChange={(value) => {
              if (value == null) return;
              onChange({
                ...draft,
                [windowEndControl.key]: Number(value),
              });
            }}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="min-w-28"
              aria-label={`${rule.title} stop sending after`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hours
                .filter((hour) => hour >= windowStart)
                .map((hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {formatTime(hour, '59')}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span>in this branch.</span>
        </div>
      ) : null}
    </div>
  );
}

function TimingControls({
  rule,
  draft,
  onChange,
  disabled,
  blocker,
  formatTime,
}: {
  rule: RuleRow;
  draft: ReminderRulePatch;
  onChange: (patch: ReminderRulePatch) => void;
  disabled: boolean;
  blocker: ActionBlocker | null;
  formatTime: (hour: number, minute?: string) => string;
}) {
  const controls = timingFields(rule);
  if (!controls.length) return null;
  const dayControls = controls.filter(
    (field) => field.type === 'integer-array'
  );
  const otherNumberControls = controls.filter(
    (field) =>
      field.type === 'integer' &&
      !['catchUpDays', 'sendWindowStart', 'sendWindowEnd'].includes(field.key)
  );
  const currentValue = (field: TimingField) =>
    currentTimingValue(rule, draft, field);
  const selectedDayCount = dayControls.reduce(
    (count, field) => count + (currentValue(field) as number[]).length,
    0
  );
  const beforeDayControl = dayControls.find(
    (field) => field.key !== 'overdueDays'
  );
  const afterDayControl = dayControls.find(
    (field) => field.key === 'overdueDays'
  );
  const beforeDays = beforeDayControl
    ? (currentValue(beforeDayControl) as number[])
    : [];
  const afterDays = afterDayControl
    ? (currentValue(afterDayControl) as number[])
    : [];
  const scheduleText = beforeDayControl
    ? reminderScheduleText(rule, beforeDays, afterDays)
    : null;
  const reminderDaysLabel = `${rule.title} change reminder days, ${selectedDayCount} selected`;
  const reminderDaysTrigger = (
    <>
      Change reminder days
      <ChevronDown className="text-muted-foreground size-4" />
    </>
  );
  return (
    <div className="space-y-3">
      {dayControls.length ? (
        <div className="space-y-3">
          <div className="max-w-2xl text-sm leading-5 text-pretty">
            {scheduleText}
          </div>
          {blocker ? (
            <ResolvableAction
              blocker={blocker}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={reminderDaysLabel}
                >
                  {reminderDaysTrigger}
                </Button>
              }
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    aria-label={reminderDaysLabel}
                  />
                }
              >
                {reminderDaysTrigger}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-60">
                {dayControls.map((field) => {
                  const selectedDays = currentValue(field) as number[];
                  const commonChoices =
                    field.key === 'overdueDays'
                      ? [1, 2, 3, 7, 14, 30]
                      : [0, 1, 2, 3, 7, 14, 30];
                  const choices = Array.from(
                    new Set([...commonChoices, ...selectedDays])
                  ).filter(
                    (day) =>
                      day >= (field.min ?? 0) && day <= (field.max ?? 365)
                  );
                  return (
                    <DropdownMenuGroup key={field.key}>
                      {dayControls.length > 1 ? (
                        <DropdownMenuLabel>
                          {timingGroupLabel(field.key)}
                        </DropdownMenuLabel>
                      ) : null}
                      {choices.map((day) => {
                        const selected = selectedDays.includes(day);
                        return (
                          <DropdownMenuCheckboxItem
                            key={day}
                            checked={selected}
                            closeOnClick={false}
                            onCheckedChange={(checked) =>
                              onChange({
                                ...draft,
                                [field.key]: (checked
                                  ? [...selectedDays, day]
                                  : selectedDays.filter(
                                      (selectedDay) => selectedDay !== day
                                    )
                                ).sort((a, b) => b - a),
                              })
                            }
                          >
                            {timingChipLabel(field.key, day)}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuGroup>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ) : hasDeliveryFields(rule) ? (
        // Without day choices there is nothing to tuck the sending options
        // behind, so they sit directly under the rule's timing.
        <DeliveryControls
          rule={rule}
          draft={draft}
          onChange={onChange}
          disabled={disabled}
          formatTime={formatTime}
        />
      ) : null}
      {otherNumberControls.map((field) => {
        const value = currentValue(field);
        return (
          <div className="max-w-xs space-y-2" key={field.key}>
            <Label htmlFor={`${rule.id}-${field.key}`}>{field.label}</Label>
            <Input
              id={`${rule.id}-${field.key}`}
              type="number"
              min={field.min}
              max={field.max}
              value={String(value)}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...draft, [field.key]: Number(event.target.value) })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function RuleMessagePreview({
  rule,
  contractId,
  fmt,
  hasUnsavedChanges,
}: {
  rule: RuleRow;
  contractId: TemplateContractId;
  fmt: ReturnType<typeof useLocale>['fmt'];
  hasUnsavedChanges: boolean;
}) {
  const contract = getTemplateContractById(contractId);
  const message = contract?.payload.body_text.replace(
    /\{\{(\d+)\}\}/g,
    (_match, index) =>
      previewValue(
        contract?.parameterLabels[Number(index) - 1] ?? 'Member',
        fmt
      )
  );
  return (
    <figure className="max-w-[30.5rem] space-y-2">
      {/* The bubble sits straight on the detail tile. ml-2 keeps its 8px tail
          inside the accordion panel, which clips anything past its edge. */}
      <div className="bg-chat-bubble-in text-foreground relative ml-2 w-fit max-w-[calc(100%-0.5rem)] rounded-lg rounded-tl-none p-2 text-sm whitespace-pre-wrap shadow-[var(--chat-bubble-shadow)]">
        <BubbleTail side="left" />
        {message}
        {contract?.payload.footer_text ? (
          <div className="text-muted-foreground mt-2 text-xs">
            {contract.payload.footer_text}
          </div>
        ) : null}
        {contract?.payload.buttons?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {contract.payload.buttons.map((button) => (
              <Button
                key={`${contractId}-${button.text}`}
                size="sm"
                variant="outline"
                disabled
              >
                {button.text}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="flex min-h-7 flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <span className="text-muted-foreground mr-auto text-xs">
          <span>This is only a sample.</span>
          {hasUnsavedChanges ? (
            <>
              {' '}
              <span>
                Save or cancel your changes before opening the message template.
              </span>
            </>
          ) : null}
        </span>
        {!hasUnsavedChanges ? (
          <Link
            data-slot="button"
            className={buttonVariants({ variant: 'link', size: 'sm' })}
            href={ruleHref(rule, contractId)}
          >
            View message template
          </Link>
        ) : null}
      </figcaption>
    </figure>
  );
}

function RuleDetail({
  rule,
  canEdit,
  draft,
  onDraftChange,
  onSave,
  lifecycleWindow,
  hasUnsavedChanges,
  onOpenInvoiceCollection,
}: {
  rule: RuleRow;
  canEdit: boolean;
  draft: ReminderRulePatch;
  onDraftChange: (patch: ReminderRulePatch) => void;
  onSave: (id: ReminderRuleId, patch: ReminderRulePatch) => Promise<void>;
  lifecycleWindow: { start: number; end: number } | null;
  hasUnsavedChanges: boolean;
  onOpenInvoiceCollection: () => void;
}) {
  const { fmt, locale } = useLocale();
  const localTime = (hour: number, minute = '00') => {
    const instant = timeInTzToUtc(
      fmt.today(),
      `${String(hour).padStart(2, '0')}:${minute}`,
      locale.timeZone
    );
    return instant ? fmt.time(instant) : '—';
  };
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length > 0;
  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave(rule.id, draft);
      onDraftChange({});
    } catch {
      // The request helper has already shown the actionable error toast.
    } finally {
      setSaving(false);
    }
  };
  const usesLifecycleWindow = LIFECYCLE_RULE_IDS.has(rule.id);
  const hasTimingControls = timingFields(rule).length > 0;
  const hasDayChoices = timingFields(rule).some(
    (field) => field.type === 'integer-array'
  );
  const sendingOptionsCollapsed = hasDayChoices && hasDeliveryFields(rule);
  const sendsAfterNine = [
    'membership_renewal',
    'service_renewal',
    'joining_installments',
  ].includes(rule.id);
  const showsLifecycleWindow =
    usesLifecycleWindow && rule.id !== 'invoice_collection';
  const showsFooter = hasTimingControls && dirty;
  return (
    <div
      className="bg-card-2 mt-3 rounded-2xl px-4 pt-4 pb-1"
      data-testid={`rule-detail-${rule.id}`}
    >
      <section className="space-y-3" aria-labelledby={`rule-when-${rule.id}`}>
        <div className="max-w-2xl space-y-1">
          {/* h4: the group heading above this row is the h3. */}
          <h4 className={DETAIL_CAPTION} id={`rule-when-${rule.id}`}>
            {hasDayChoices
              ? 'When will members get reminders?'
              : 'When this message is sent'}
          </h4>
          {hasDayChoices ? null : (
            <div className="text-sm leading-5 text-pretty">
              {rule.id === 'joining_installments'
                ? 'Sent 7, 3, and 1 days before each payment is due, and again on the due date.'
                : timingSummary(rule)}
            </div>
          )}
          {rule.id === 'joining_installments' ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-sm leading-5">
              <span>The member’s payment plan sets these dates.</span>
              {!hasUnsavedChanges ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link href={branchHref('/members', browserBranchId())} />
                  }
                  variant="link"
                  size="sm"
                >
                  View member payment plans
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <TimingControls
          rule={rule}
          draft={draft}
          onChange={onDraftChange}
          disabled={!canEdit || saving}
          blocker={canEdit ? null : EDIT_PERMISSION_BLOCKER}
          formatTime={localTime}
        />
      </section>
      <Separator className="mt-4" />
      <Accordion multiple>
        {sendingOptionsCollapsed ? (
          <AccordionItem value={`delivery-${rule.id}`}>
            <AccordionTrigger>More sending options</AccordionTrigger>
            <AccordionContent className="px-1">
              <DeliveryControls
                rule={rule}
                draft={draft}
                onChange={onDraftChange}
                disabled={!canEdit || saving}
                formatTime={localTime}
              />
            </AccordionContent>
          </AccordionItem>
        ) : null}
        <AccordionItem value={`details-${rule.id}`}>
          <AccordionTrigger>See message and details</AccordionTrigger>
          <AccordionContent className="space-y-5 px-1">
            {rule.templateContracts.length > 1 ? (
              <Tabs defaultValue={rule.templateContracts[0]}>
                <TabsList aria-label={`${rule.title} message preview`}>
                  {rule.templateContracts.map((contractId) => (
                    <TabsTrigger key={contractId} value={contractId}>
                      {previewTabLabel(contractId)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {rule.templateContracts.map((contractId) => (
                  <TabsContent key={contractId} value={contractId}>
                    <RuleMessagePreview
                      rule={rule}
                      contractId={contractId}
                      fmt={fmt}
                      hasUnsavedChanges={hasUnsavedChanges}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <RuleMessagePreview
                rule={rule}
                contractId={rule.templateContracts[0]}
                fmt={fmt}
                hasUnsavedChanges={hasUnsavedChanges}
              />
            )}
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <div className="space-y-1">
                <dt className={DETAIL_CAPTION}>Who gets it</dt>
                <dd className="text-sm leading-5 text-pretty">
                  {RULE_DETAILS[rule.id].eligibility}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className={DETAIL_CAPTION}>When it stops</dt>
                <dd className="text-sm leading-5 text-pretty">
                  {RULE_DETAILS[rule.id].stops}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className={DETAIL_CAPTION}>What staff should do</dt>
                <dd className="text-sm leading-5 text-pretty">
                  {RULE_DETAILS[rule.id].staff}
                </dd>
              </div>
              {rule.id === 'autopay_recovery' ? (
                <div className="space-y-1 sm:col-span-3">
                  <dt className={DETAIL_CAPTION}>How AutoPay retries work</dt>
                  <dd className="max-w-3xl text-sm leading-5 text-pretty">
                    A retry message tells the member when AutoPay will try
                    again. It does not ask them to pay another way. A final
                    failure message may ask for payment after UsefulDesk checks
                    the account.
                  </dd>
                </div>
              ) : null}
            </dl>
            {sendsAfterNine ? (
              <div className="text-muted-foreground max-w-2xl text-sm leading-5">
                UsefulDesk can send this message after {localTime(9)} in this
                branch.
              </div>
            ) : null}
            {showsLifecycleWindow && lifecycleWindow ? (
              <div className="space-y-1">
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-sm leading-5">
                  <span>
                    UsefulDesk can send this message from{' '}
                    {localTime(lifecycleWindow.start)} to{' '}
                    {localTime(lifecycleWindow.end, '59')} in this branch.
                  </span>
                  {!dirty ? (
                    <Button
                      variant="link"
                      size="sm"
                      onClick={onOpenInvoiceCollection}
                    >
                      Change sending hours
                    </Button>
                  ) : null}
                </div>
                {dirty ? (
                  <div className="text-muted-foreground text-xs">
                    Save or cancel these changes before changing the sending
                    hours.
                  </div>
                ) : null}
              </div>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {showsFooter ? (
        <>
          <Separator />
          <div className="flex justify-end gap-2 py-3">
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => onDraftChange({})}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={saving}
              disabled={!canEdit}
              onClick={save}
            >
              Save settings
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function RuleRow({
  rule,
  canEdit,
  hasDraft,
  expanded,
  children,
  onOpen,
  onSetupTemplate,
  onSave,
}: {
  rule: RuleRow;
  canEdit: boolean;
  hasDraft: boolean;
  expanded: boolean;
  children: ReactNode;
  onOpen: () => void;
  onSetupTemplate: (contractId: TemplateContractId) => void;
  onSave: (id: ReminderRuleId, patch: ReminderRulePatch) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const enabled = isEnabled(rule);
  const canToggle = rule.fields.some((field) => field.key === 'enabled');
  const needsSetup = canToggle && !enabled && !rule.readiness.ready;
  const hasEditableSettings = timingFields(rule).length > 0;
  const readinessBlocker: ActionBlocker | null =
    !enabled && !rule.readiness.ready
      ? {
          title:
            rule.readiness.code === 'whatsapp_not_connected'
              ? 'WhatsApp isn’t connected'
              : 'This template needs setup',
          description:
            rule.readiness.message ??
            'Connect WhatsApp and approve the exact template before it can send.',
          ...(rule.readiness.code === 'whatsapp_not_connected'
            ? hasDraft
              ? {
                  description:
                    'Save or cancel unsaved rule changes before opening WhatsApp settings.',
                }
              : {
                  resolution: {
                    label: 'Open WhatsApp settings',
                    href: setupHref(rule),
                  },
                }
            : {
                resolution: {
                  label: 'Set up required template',
                  onResolve: () =>
                    onSetupTemplate(
                      rule.readiness.templateContractId ??
                        rule.templateContracts[0]
                    ),
                },
              }),
        }
      : null;
  const blocker = canEdit ? readinessBlocker : EDIT_PERMISSION_BLOCKER;
  const toggle = async () => {
    setSaving(true);
    try {
      await onSave(rule.id, { enabled: !enabled });
    } catch {
      // The request helper has already shown the actionable error toast.
    } finally {
      setSaving(false);
    }
  };
  const openLabel = expanded
    ? 'Close'
    : hasEditableSettings && canEdit
      ? 'Configure'
      : 'View';
  return (
    // The card's padding frames the first and last rows, as on Activity.
    // A revealed first row keeps its group heading in view.
    <div
      className="border-border scroll-mt-4 border-b py-3 first:scroll-mt-16 first:pt-0 last:border-b-0 last:pb-0"
      data-testid={`rule-row-${rule.id}`}
      data-expanded={expanded || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-48 flex-1">
          <div className="flex items-center gap-1">
            <p className="font-medium" id={`rule-title-${rule.id}`}>
              {rule.title}
            </p>
            <Tooltip>
              <TooltipTrigger
                delay={350}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`About ${rule.title}`}
                  />
                }
              >
                <Info aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-pretty">
                {RULE_DETAILS[rule.id].meaning}
              </TooltipContent>
            </Tooltip>
          </div>
          {!expanded ? (
            <p className="text-muted-foreground text-sm">
              {timingSummary(rule)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {needsSetup ? (
            <ResolvableAction
              blocker={blocker}
              disabled={saving}
              onAction={toggle}
              trigger={
                <Button size="sm" variant="outline">
                  Set up
                </Button>
              }
            />
          ) : canToggle ? (
            <>
              <span className="text-muted-foreground text-sm">
                {enabled && !rule.readiness.ready
                  ? 'Blocked'
                  : enabled
                    ? 'On'
                    : 'Off'}
              </span>
              <ResolvableAction
                blocker={blocker}
                triggerNativeButton={false}
                onAction={toggle}
                trigger={
                  <Switch
                    // A blocked trigger renders as a popover trigger, whose
                    // role="button" would otherwise replace the switch role.
                    role="switch"
                    checked={enabled}
                    readOnly={!canEdit}
                    disabled={saving}
                    aria-busy={saving}
                    aria-label={`${rule.title} automation`}
                  />
                }
              />
              {saving ? (
                <Loader2
                  className="text-muted-foreground size-4 animate-spin"
                  role="status"
                  aria-label="Saving activation"
                />
              ) : null}
            </>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={onOpen}
            id={`rule-configure-${rule.id}`}
            // Every rule is on one page, so each toggle names its rule.
            aria-label={`${openLabel} ${rule.title}`}
            aria-expanded={expanded}
            aria-controls={`rule-panel-${rule.id}`}
          >
            {openLabel}
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </div>
      <Collapse open={expanded} duration={ROW_COLLAPSE_SECONDS}>
        <div
          id={`rule-panel-${rule.id}`}
          role="region"
          aria-labelledby={`rule-title-${rule.id}`}
        >
          {children}
        </div>
      </Collapse>
    </div>
  );
}

export function RenewalRemindersSettings() {
  const { canEditSettings, accountId } = useAuth();
  const canViewActivity = useCan('view-automated-message-activity');
  const searchParams = useSearchParams();
  const branchParam = searchParams.get('branch');
  const draftScope = `${accountId ?? 'anonymous'}:${branchParam ?? 'primary'}`;
  const [view, setView] = useState('rules');
  const [templateSetup, setTemplateSetup] = useState<{
    contractId: TemplateContractId;
    scope: string;
  } | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [selectedId, setSelectedId] = useState<ReminderRuleId | null>(null);
  const rulesRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<RuleReveal | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReminderRulePatch>>({});
  const [dismissedLinkedRule, setDismissedLinkedRule] = useState<string | null>(
    null
  );
  const hasUnsavedChanges = Object.entries(drafts).some(
    ([key, patch]) =>
      key.startsWith(`${draftScope}:`) && Object.keys(patch).length > 0
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const branchId = browserBranchId();
        const response = await fetch('/api/reminders/settings', {
          cache: 'no-store',
          headers: branchId ? { [BRANCH_HEADER]: branchId } : undefined,
        });
        const data = await response.json();
        if (!response.ok) {
          // Retrying cannot change an access decision, so 401/403 offer no
          // Try again.
          if (!cancelled)
            setError({
              message: data?.error || 'Automated messages couldn’t load.',
              canRetry: response.status !== 401 && response.status !== 403,
            });
          return;
        }
        if (!cancelled) {
          setRules(data.rules ?? []);
          // The loading state replaced the whole list and dropped the
          // scroll position, so return to the open or linked rule.
          setReveal({ navigate: false, afterCollapse: false });
        }
      } catch (loadError) {
        if (!cancelled)
          setError({
            message: getErrorMessage(
              loadError,
              'Automated messages couldn’t load. Try again.'
            ),
            canRetry: true,
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchParam, reloadNonce]);
  useEffect(() => {
    if (!reveal) return;
    const row = rulesRef.current?.querySelector<HTMLElement>('[data-expanded]');
    if (!row) return;
    if (reveal.navigate) {
      row
        .querySelector<HTMLElement>('[aria-controls^="rule-panel-"]')
        ?.focus({ preventScroll: true });
    }
    // Scroll once the row stops moving. The Activity panel unmounts a frame
    // after the switch, and a row closing above this one moves it until its
    // Collapse ends, which can take longer than its duration on a busy page.
    const start = performance.now();
    const minWait = reveal.afterCollapse ? ROW_COLLAPSE_SECONDS * 1000 : 0;
    let lastTop = Number.NaN;
    let frame = 0;
    const step = () => {
      const top = row.getBoundingClientRect().top;
      const elapsed = performance.now() - start;
      if ((elapsed >= minWait && top === lastTop) || elapsed > 2000) {
        row.scrollIntoView({
          block: 'start',
          behavior:
            reveal.navigate &&
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'smooth'
              : 'auto',
        });
        return;
      }
      lastTop = top;
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [reveal]);
  const queryRuleId = searchParams.get('rule');
  const linkedRuleId = REMINDER_RULES.some((rule) => rule.id === queryRuleId)
    ? (queryRuleId as ReminderRuleId)
    : null;
  const activeRuleId =
    selectedId ?? (dismissedLinkedRule === linkedRuleId ? null : linkedRuleId);
  const selected = rules.find((rule) => rule.id === activeRuleId) ?? null;
  const invoiceCollection = rules.find(
    (rule) => rule.id === 'invoice_collection'
  );
  const lifecycleWindow = invoiceCollection
    ? {
        start: Number(invoiceCollection.settings.sendWindowStart ?? 9),
        end: Number(invoiceCollection.settings.sendWindowEnd ?? 19),
      }
    : null;
  const sections = useMemo(
    () =>
      REMINDER_RULE_GROUPS.map((group) => ({
        group,
        rules: rules.filter((rule) => rule.group === group),
      })).filter((section) => section.rules.length > 0),
    [rules]
  );
  /** Opens a rule from a control outside its row and scrolls to it. */
  const goToRule = (ruleId: ReminderRuleId) => {
    setReveal({
      navigate: true,
      afterCollapse:
        view === 'rules' && activeRuleId !== null && activeRuleId !== ruleId,
    });
    setSelectedId(ruleId);
    setDismissedLinkedRule(null);
    setView('rules');
  };
  const save = async (ruleId: ReminderRuleId, patch: ReminderRulePatch) => {
    try {
      const branchId = browserBranchId();
      const response = await fetch('/api/reminders/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(branchId ? { [BRANCH_HEADER]: branchId } : {}),
        },
        body: JSON.stringify({ ruleId, patch }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data?.error || 'Automated message settings couldn’t be saved.'
        );
      // A branch navigation can happen while the request is in flight. Its
      // response belongs to the branch that initiated the mutation, never the
      // newly visible branch.
      if (browserBranchId() !== branchId) return;
      setRules((current) =>
        current.map((rule) => (rule.id === ruleId ? data.rule : rule))
      );
      toast.success('Automated message saved');
    } catch (saveError) {
      toast.error(
        getErrorMessage(
          saveError,
          'Automated message settings couldn’t be saved. Try again.'
        )
      );
      throw saveError;
    }
  };
  const rulesContent = loading ? (
    <div
      className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
      role="status"
    >
      <Loader2 className="size-4 animate-spin" />
      Loading automated messages…
    </div>
  ) : error ? (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Automated messages couldn’t load</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {error.canRetry ? (
          <Button
            className="mt-3"
            size="sm"
            variant="destructive"
            onClick={() => setReloadNonce((value) => value + 1)}
          >
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  ) : (
    <div ref={rulesRef} className="space-y-8">
      {!canEditSettings ? (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Only admins and owners can change automated messages.
          </AlertDescription>
        </Alert>
      ) : null}
      <TooltipProvider>
        {sections.map((section) => (
          <section
            key={section.group}
            aria-labelledby={`rule-group-${section.group}`}
            className="space-y-3"
          >
            <SettingsSectionHead
              id={`rule-group-${section.group}`}
              title={REMINDER_RULE_GROUP_LABELS[section.group]}
            />
            <Card>
              <CardContent>
                {section.rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    canEdit={canEditSettings}
                    hasDraft={hasUnsavedChanges}
                    expanded={selected?.id === rule.id}
                    onOpen={() => {
                      if (selected?.id === rule.id) {
                        setSelectedId(null);
                        setDismissedLinkedRule(linkedRuleId);
                      } else {
                        setSelectedId(rule.id);
                        setDismissedLinkedRule(null);
                      }
                    }}
                    onSetupTemplate={(contractId) => {
                      setSelectedId(rule.id);
                      setDismissedLinkedRule(null);
                      setTemplateSetup({ contractId, scope: draftScope });
                    }}
                    onSave={save}
                  >
                    <RuleDetail
                      rule={rule}
                      canEdit={canEditSettings}
                      draft={drafts[`${draftScope}:${rule.id}`] ?? {}}
                      onDraftChange={(patch) =>
                        setDrafts((current) => ({
                          ...current,
                          [`${draftScope}:${rule.id}`]: patch,
                        }))
                      }
                      onSave={save}
                      lifecycleWindow={lifecycleWindow}
                      hasUnsavedChanges={hasUnsavedChanges}
                      onOpenInvoiceCollection={() =>
                        goToRule('invoice_collection')
                      }
                    />
                  </RuleRow>
                ))}
              </CardContent>
            </Card>
          </section>
        ))}
      </TooltipProvider>
    </div>
  );
  return (
    <>
      <section className="max-w-5xl">
        <SettingsPanelHead
          title="Automated messages"
          description="Choose which member events can send an approved WhatsApp message."
        />
        {/* Rules and Activity are this panel's views, so their tabs sit under
            its heading. The app bar's tab row belongs to Settings, whose own
            navigation is the rail. */}
        <Tabs value={view} onValueChange={setView}>
          {/* The panel's divider plays the app bar's: -mb-px seats the active
              underline on it. */}
          <div className="border-border border-b">
            <TabsList
              variant="line"
              aria-label="Automated messages"
              className="-mb-px h-auto gap-5 p-0"
            >
              <TabsTrigger value="rules" className={TAB_TRIGGER_CLASS}>
                Rules
              </TabsTrigger>
              <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
                Activity
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="rules" className="mt-4">
            {rulesContent}
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            {canViewActivity ? (
              <AutomatedMessageActivity
                onReviewRule={(id) => {
                  const rule = REMINDER_RULES.find((item) => item.id === id);
                  if (rule) goToRule(rule.id);
                }}
              />
            ) : (
              // The tab stays visible (gate, don't hide), but its history is
              // admin-only in the database, so nothing is requested here.
              <Alert>
                <AlertTitle>Admin access required</AlertTitle>
                <AlertDescription>
                  Only admins and owners can view scheduled reminder readiness
                  and message history.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>
      </section>
      {templateSetup?.scope === draftScope ? (
        <TemplateManager
          key={`${draftScope}:${templateSetup.contractId}`}
          setupContractId={templateSetup.contractId}
          onSetupClose={(submitted) => {
            setTemplateSetup(null);
            if (submitted) setReloadNonce((value) => value + 1);
          }}
        />
      ) : null}
    </>
  );
}
