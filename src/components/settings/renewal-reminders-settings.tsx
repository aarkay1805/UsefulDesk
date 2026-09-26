'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { AutomatedMessageActivity } from '@/components/settings/automated-message-activity';
import { AutomatedMessageSetup } from '@/components/settings/automated-message-setup';
import {
  LifecycleSendingHoursSettings,
  LIFECYCLE_SENDING_HOURS_RULE_IDS,
  type LifecycleSendingHoursDraft,
} from '@/components/settings/lifecycle-sending-hours-settings';
import { BubbleTail } from '@/components/inbox/message-bubble';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapse } from '@/components/ui/collapse';
import { Chip, ChipGroup } from '@/components/ui/chip';
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
import { renderTemplateBody } from '@/lib/whatsapp/template-render';
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
  title: 'You do not have permission',
  description: 'Only the owner or an admin can change automated messages.',
};

const UNSAVED_CHANGES_MESSAGE =
  'You have unsaved changes to automated messages. Leave this page and lose them?';

type RuleRow = ReminderRule & {
  settings: Record<string, unknown>;
  readiness: {
    ready: boolean;
    code: string;
    message?: string;
    templateContractId?: (typeof REMINDER_RULES)[number]['templateContracts'][number];
  };
};

const LIFECYCLE_RULE_IDS = new Set<ReminderRuleId>(
  LIFECYCLE_SENDING_HOURS_RULE_IDS
);

function isEnabled(rule: RuleRow) {
  return rule.settings.enabled === true;
}

type RuleSetupStatus = {
  label: string;
  variant: 'neutral' | 'info' | 'warning' | 'danger';
  /** The verb on the row's one setup action. */
  action: string;
};

/**
 * One status per unready row, named for what WhatsApp is doing with the
 * message, and the specific next step. "Needs setup" alone left the owner
 * guessing whether to act or wait.
 */
function ruleSetupStatus(rule: RuleRow): RuleSetupStatus | null {
  if (rule.readiness.ready) return null;
  const status: RuleSetupStatus = (() => {
    switch (rule.readiness.code) {
      case 'whatsapp_not_connected':
        return {
          label: 'WhatsApp not connected',
          variant: 'neutral',
          action: 'Connect WhatsApp',
        };
      case 'missing':
      case 'not_approved':
        return {
          label: 'Not sent for review',
          variant: 'neutral',
          action: 'Send for review',
        };
      case 'pending':
        return {
          label: 'In WhatsApp review',
          variant: 'info',
          action: 'View status',
        };
      case 'rejected':
        return {
          label: 'Rejected by WhatsApp',
          variant: 'danger',
          action: 'Fix and resend',
        };
      case 'paused':
        return {
          label: 'Paused by WhatsApp',
          variant: 'warning',
          action: 'Resend',
        };
      case 'disabled':
        return {
          label: 'Turned off by WhatsApp',
          variant: 'danger',
          action: 'View status',
        };
      case 'component_drift':
      case 'parameter_drift':
      case 'wrong_parameter_format':
        return {
          label: 'Needs an update',
          variant: 'warning',
          action: 'Update message',
        };
      default:
        return {
          label: 'Needs attention',
          variant: 'warning',
          action: 'View status',
        };
    }
  })();
  // A rule left On keeps its preference when readiness is lost, and the
  // owner must not read that as "sending".
  return isEnabled(rule)
    ? {
        ...status,
        label: `On, not sending: ${status.label.charAt(0).toLowerCase()}${status.label.slice(1)}`,
        variant: 'danger',
      }
    : status;
}

function settingValuesEqual(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value) => right.includes(value))
    );
  return left === right;
}

function normalizeRulePatch(rule: RuleRow, patch: ReminderRulePatch) {
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => !settingValuesEqual(value, rule.settings[key])
    )
  ) as ReminderRulePatch;
}

function timingSummary(rule: RuleRow) {
  if (rule.id === 'invoice_collection') {
    const before = rule.settings.beforeDueDays;
    const overdue = rule.settings.overdueDays;
    if (Array.isArray(before) || Array.isArray(overdue))
      return reminderScheduleText(
        rule,
        Array.isArray(before) ? before : [],
        Array.isArray(overdue) ? overdue : []
      );
  }
  const schedule = rule.fields.find((field) => field.type === 'integer-array');
  if (schedule && Array.isArray(rule.settings[schedule.key])) {
    const values = rule.settings[schedule.key] as number[];
    return reminderScheduleText(rule, values, []);
  }
  return rule.schedule.timing;
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

function previewValue(
  sampleValue: string,
  fmt: ReturnType<typeof useLocale>['fmt']
) {
  const money = /^₹([\d,]+(?:\.\d{1,2})?)$/.exec(sampleValue);
  if (money) return fmt.money(Number(money[1].replaceAll(',', '')));

  const date = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(sampleValue);
  if (date) {
    const month =
      [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ].indexOf(date[2]) + 1;
    if (month > 0)
      return fmt.date(
        `${date[3]}-${String(month).padStart(2, '0')}-${date[1].padStart(2, '0')}`
      );
  }
  return sampleValue;
}

function timingFields(rule: RuleRow) {
  return rule.fields.filter(
    (field) =>
      field.key !== 'enabled' &&
      field.type !== 'boolean' &&
      field.key !== 'sendWindowStart' &&
      field.key !== 'sendWindowEnd'
  );
}

/** A chip only names the offset; its group caption names what it is
 *  counted from, so seven chips fit one row. */
function dayChipLabel(fieldKey: string, day: number) {
  if (day === 0)
    return fieldKey === 'daysBefore' ? 'On the day' : 'On the due date';
  return `${day} day${day === 1 ? '' : 's'}`;
}

function dayGroupCaption(rule: RuleRow, fieldKey: string) {
  if (fieldKey === 'overdueDays') return 'After payment is due';
  if (fieldKey === 'beforeDueDays') return 'Before payment is due';
  return rule.id === 'service_renewal'
    ? 'Before the service ends'
    : 'Before the membership ends';
}

function lateSendLabel(days: number) {
  if (days === 0) return '0 days';
  return `${days} day${days === 1 ? '' : 's'}`;
}

function numberList(values: number[]) {
  if (values.length < 2) return String(values[0] ?? '');
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
}

function joinPhrases(parts: string[]) {
  if (parts.length < 2) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function dayPhrase(values: number[]) {
  return `${numberList(values)} ${values.length === 1 && values[0] === 1 ? 'day' : 'days'}`;
}

function timingValidationMessage(
  rule: RuleRow,
  draft: ReminderRulePatch
): string | null {
  for (const field of timingFields(rule)) {
    if (field.type !== 'integer-array') continue;
    const value = currentTimingValue(rule, draft, field);
    if (!Array.isArray(value) || value.length === 0)
      return 'Select at least one reminder day.';
    if (field.maxItems && value.length > field.maxItems)
      return `Select no more than ${field.maxItems} reminder days.`;
  }
  return null;
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
  return keys.includes('catchUpDays');
}

function DeliveryControls({
  rule,
  draft,
  onChange,
  disabled,
}: {
  rule: RuleRow;
  draft: ReminderRulePatch;
  onChange: (patch: ReminderRulePatch) => void;
  disabled: boolean;
}) {
  const controls = timingFields(rule);
  const catchUpControl = controls.find((field) => field.key === 'catchUpDays');
  return (
    <div className="space-y-3">
      {catchUpControl ? (
        <div className="space-y-2">
          <div className={DETAIL_CAPTION}>If a message is late</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Send it up to</span>
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
            <span>after its scheduled date.</span>
          </div>
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
}: {
  rule: RuleRow;
  draft: ReminderRulePatch;
  onChange: (patch: ReminderRulePatch) => void;
  disabled: boolean;
  blocker: ActionBlocker | null;
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
  const reminderDaysLabel = `${rule.title} change reminder days, ${selectedDayCount} selected`;
  const validationMessage = timingValidationMessage(rule, draft);
  const validationId = `${rule.id}-timing-error`;
  const reminderDaysTrigger = (
    <>
      Change reminder days
      <ChevronDown className="text-muted-foreground size-4" />
    </>
  );
  return (
    <div className="space-y-3">
      {dayControls.length ? (
        <div className="space-y-4">
          {blocker ? (
            <ResolvableAction
              blocker={blocker}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={reminderDaysLabel}
                  aria-invalid={validationMessage ? true : undefined}
                  aria-describedby={
                    validationMessage ? validationId : undefined
                  }
                >
                  {reminderDaysTrigger}
                </Button>
              }
            />
          ) : (
            // Every choice is visible and one press away, the way calendar
            // and invoicing apps list reminder offsets, instead of behind a
            // menu the owner has to open to learn what is possible.
            dayControls.map((field) => {
              const selectedDays = currentValue(field) as number[];
              const commonChoices =
                field.key === 'overdueDays'
                  ? [1, 2, 3, 7, 14, 30]
                  : [30, 14, 7, 3, 2, 1, 0];
              const choices = Array.from(
                new Set([...commonChoices, ...selectedDays])
              )
                .filter(
                  (day) => day >= (field.min ?? 0) && day <= (field.max ?? 365)
                )
                .sort((a, b) => (field.key === 'overdueDays' ? a - b : b - a));
              const atLimit =
                field.maxItems !== undefined &&
                selectedDays.length >= field.maxItems;
              const groupLabel = dayGroupCaption(rule, field.key);
              const labelId = `${rule.id}-${field.key}-label`;
              const hintId = `${rule.id}-${field.key}-hint`;
              return (
                <div className="space-y-2" key={field.key}>
                  <div id={labelId} className="text-sm">
                    {groupLabel}
                  </div>
                  <ChipGroup<string>
                    selectionMode="multiple"
                    value={selectedDays.map(String)}
                    onValueChange={(values) =>
                      onChange({
                        ...draft,
                        [field.key]: values.map(Number).sort((a, b) => b - a),
                      })
                    }
                    aria-label={`${rule.title}: ${groupLabel.toLowerCase()}`}
                    aria-describedby={
                      [
                        atLimit ? hintId : null,
                        validationMessage ? validationId : null,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                  >
                    {choices.map((day) => {
                      const selected = selectedDays.includes(day);
                      return (
                        <Chip
                          key={day}
                          value={String(day)}
                          disabled={disabled || (!selected && atLimit)}
                        >
                          {dayChipLabel(field.key, day)}
                        </Chip>
                      );
                    })}
                  </ChipGroup>
                  {/* The limit only needs saying once it is reached; the
                      disabled chips alone would read as broken. */}
                  {atLimit ? (
                    <div id={hintId} className="text-muted-foreground text-xs">
                      Up to {field.maxItems} days. Remove one to pick another.
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {validationMessage ? (
            <p
              id={validationId}
              className="text-destructive text-xs"
              role="alert"
            >
              {validationMessage}
            </p>
          ) : null}
        </div>
      ) : hasDeliveryFields(rule) ? (
        // Without day choices there is nothing to tuck the sending options
        // behind, so they sit directly under the rule's timing.
        <DeliveryControls
          rule={rule}
          draft={draft}
          onChange={onChange}
          disabled={disabled}
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
  const message = contract
    ? renderTemplateBody(
        contract.payload.body_text,
        (contract.payload.sample_values?.body ?? []).map((sampleValue) =>
          previewValue(sampleValue, fmt)
        )
      )
    : null;
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
      {/* The link continues the caption's sentence instead of floating at
          the bubble's far edge. */}
      <figcaption className="flex min-h-7 flex-wrap items-center gap-x-1">
        <span className="text-muted-foreground text-xs">
          <span>This is a sample message.</span>
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
  onOpenSendingHours,
}: {
  rule: RuleRow;
  canEdit: boolean;
  draft: ReminderRulePatch;
  onDraftChange: (patch: ReminderRulePatch) => void;
  onSave: (id: ReminderRuleId, patch: ReminderRulePatch) => Promise<void>;
  lifecycleWindow: { start: number; end: number } | null;
  hasUnsavedChanges: boolean;
  onOpenSendingHours: () => void;
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
  const validationMessage = timingValidationMessage(rule, draft);
  const save = async () => {
    if (!dirty || validationMessage) return;
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
  const sendingHoursLink = (
    <Button variant="link" size="sm" onClick={onOpenSendingHours}>
      Change sending hours
    </Button>
  );
  // Each note is one line of fact the schedule itself cannot show: when in
  // the day it goes out, and any caveat about the date it counts from.
  const timingNotes = [
    rule.schedule.anchorNote ? (
      <div key="anchor">{rule.schedule.anchorNote}</div>
    ) : null,
    sendsAfterNine ? (
      <div key="after-nine">Sends after {localTime(9)}, branch time.</div>
    ) : null,
    usesLifecycleWindow && lifecycleWindow ? (
      <div key="window" className="flex flex-wrap items-center gap-x-1">
        <span>
          Sends during Sending hours, {localTime(lifecycleWindow.start)}–
          {localTime(lifecycleWindow.end, '59')}.
        </span>
        {sendingHoursLink}
      </div>
    ) : null,
    rule.id === 'attendance_streak' && lifecycleWindow ? (
      <div key="arrival" className="flex flex-wrap items-center gap-x-1">
        <span>
          Without a usual time, it sends at{' '}
          {localTime(lifecycleWindow.end, '30')}.
        </span>
        {sendingHoursLink}
      </div>
    ) : null,
    rule.id === 'joining_installments' ? (
      <div key="installments" className="flex flex-wrap items-center gap-x-1">
        <span>Installment dates are on each member’s Membership tab.</span>
        {!hasUnsavedChanges ? (
          <Button
            nativeButton={false}
            render={<Link href={branchHref('/members', browserBranchId())} />}
            variant="link"
            size="sm"
          >
            Find a member
          </Button>
        ) : null}
      </div>
    ) : null,
  ].filter(Boolean);
  return (
    <div
      className="bg-card-2 mt-3 rounded-2xl px-4 pt-4 pb-1"
      data-testid={`rule-detail-${rule.id}`}
    >
      <section className="space-y-3" aria-labelledby={`rule-when-${rule.id}`}>
        {/* The row's own subtitle already reads the schedule back, live, so
            the tile opens straight onto what can be changed. */}
        <h5 className={DETAIL_CAPTION} id={`rule-when-${rule.id}`}>
          Timing
        </h5>
        {hasDayChoices ? null : (
          <div className="text-muted-foreground max-w-2xl text-sm leading-5 text-pretty">
            {rule.schedule.explanation}
          </div>
        )}
        <TimingControls
          rule={rule}
          draft={draft}
          onChange={onDraftChange}
          disabled={!canEdit || saving}
          blocker={canEdit ? null : EDIT_PERMISSION_BLOCKER}
        />
        {timingNotes.length ? (
          <div className="text-muted-foreground max-w-2xl space-y-1 text-sm leading-5 text-pretty">
            {timingNotes}
          </div>
        ) : null}
        {sendingOptionsCollapsed ? (
          <Accordion>
            <AccordionItem value={`delivery-${rule.id}`}>
              <AccordionTrigger>More sending options</AccordionTrigger>
              <AccordionContent className="px-1">
                <DeliveryControls
                  rule={rule}
                  draft={draft}
                  onChange={onDraftChange}
                  disabled={!canEdit || saving}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
        {hasTimingControls && dirty ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span
              className="text-amber-foreground mr-auto text-sm"
              role="status"
            >
              Unsaved changes
            </span>
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
              disabled={!canEdit || Boolean(validationMessage)}
              onClick={save}
            >
              Save changes
            </Button>
          </div>
        ) : null}
      </section>
      <Separator className="mt-4" />
      <section
        className="space-y-3 py-4"
        aria-labelledby={`rule-preview-${rule.id}`}
      >
        <h5 className={DETAIL_CAPTION} id={`rule-preview-${rule.id}`}>
          Message preview
        </h5>
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
        <Accordion>
          <AccordionItem value={`operation-${rule.id}`}>
            <AccordionTrigger>Who gets this message</AccordionTrigger>
            <AccordionContent className="px-1">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <dt className={DETAIL_CAPTION}>Who gets it</dt>
                  <dd className="text-sm leading-5 text-pretty">
                    {rule.eligibility}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className={DETAIL_CAPTION}>When it stops</dt>
                  <dd className="text-sm leading-5 text-pretty">
                    {rule.stops}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className={DETAIL_CAPTION}>What your team should do</dt>
                  <dd className="text-sm leading-5 text-pretty">
                    {rule.staff}
                  </dd>
                </div>
                {rule.id === 'autopay_recovery' ? (
                  <div className="space-y-1 sm:col-span-3">
                    <dt className={DETAIL_CAPTION}>How AutoPay retries work</dt>
                    <dd className="max-w-3xl text-sm leading-5 text-pretty">
                      A retry message tells the member when AutoPay will try
                      again. It does not ask them to pay another way. A final
                      failure message may ask for payment after UsefulDesk
                      checks the account.
                    </dd>
                  </div>
                ) : null}
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  );
}

function RuleRow({
  rule,
  summary,
  canEdit,
  expanded,
  children,
  onOpen,
  onSetupTemplate,
  onSave,
}: {
  rule: RuleRow;
  /** The schedule in words, including unsaved day changes, so the row
   *  reads back each chip as it is pressed. */
  summary: string;
  canEdit: boolean;
  expanded: boolean;
  children: ReactNode;
  onOpen: () => void;
  onSetupTemplate: (contractId: TemplateContractId) => void;
  onSave: (id: ReminderRuleId, patch: ReminderRulePatch) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const enabled = isEnabled(rule);
  const canToggle = rule.fields.some((field) => field.key === 'enabled');
  const needsSetup = !rule.readiness.ready;
  const configurationExpanded = expanded && !needsSetup;
  const setupContractId =
    rule.readiness.templateContractId ?? rule.templateContracts[0];
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
  const openLabel = configurationExpanded ? 'Close' : 'Edit';
  const setupStatus = ruleSetupStatus(rule);
  const setupLabel = `${setupStatus?.action ?? 'Set up'}: ${rule.title}`;
  const setupButton = (
    <Button size="sm" variant="outline" aria-label={setupLabel}>
      {setupStatus?.action}
    </Button>
  );
  const setupAction = canEdit ? (
    rule.readiness.code === 'whatsapp_not_connected' ? (
      <Button
        nativeButton={false}
        render={<Link href={setupHref(rule)} />}
        size="sm"
        variant="outline"
        aria-label={setupLabel}
      >
        {setupStatus?.action}
      </Button>
    ) : (
      <Button
        size="sm"
        variant="outline"
        aria-label={setupLabel}
        onClick={() => onSetupTemplate(setupContractId)}
      >
        {setupStatus?.action}
      </Button>
    )
  ) : (
    <ResolvableAction blocker={EDIT_PERMISSION_BLOCKER} trigger={setupButton} />
  );
  return (
    // The card's padding frames the first and last rows, as on Activity.
    // A revealed first row keeps its group heading in view.
    <div
      className="border-border scroll-mt-4 border-b py-3 first:scroll-mt-16 first:pt-0 last:border-b-0 last:pb-0"
      data-testid={`rule-row-${rule.id}`}
      data-expanded={configurationExpanded || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-48 flex-1">
          <h4 className="font-medium" id={`rule-title-${rule.id}`}>
            {rule.title}
          </h4>
          <p className="text-muted-foreground text-sm text-pretty">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {setupStatus ? (
            <Badge variant={setupStatus.variant}>{setupStatus.label}</Badge>
          ) : null}
          {!canToggle ? (
            <span className="text-muted-foreground text-sm">
              Set by the installment plan
            </span>
          ) : null}
          {needsSetup ? setupAction : null}
          {canToggle && !needsSetup ? (
            <>
              <span className="text-muted-foreground text-sm">
                {enabled ? 'On' : 'Off'}
              </span>
              <ResolvableAction
                blocker={canEdit ? null : EDIT_PERMISSION_BLOCKER}
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
                  aria-label="Saving…"
                />
              ) : null}
            </>
          ) : null}
          {!needsSetup ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onOpen}
              id={`rule-configure-${rule.id}`}
              // Every rule is on one page, so each toggle names its rule.
              aria-label={`${openLabel} ${rule.title}`}
              aria-expanded={configurationExpanded}
              aria-controls={`rule-panel-${rule.id}`}
            >
              {openLabel}
              {configurationExpanded ? <ChevronUp /> : <ChevronDown />}
            </Button>
          ) : null}
        </div>
      </div>
      <Collapse open={configurationExpanded} duration={ROW_COLLAPSE_SECONDS}>
        <div
          id={`rule-panel-${rule.id}`}
          role="region"
          aria-labelledby={`rule-title-${rule.id}`}
        >
          {needsSetup ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {rule.readiness.message ??
                'Connect WhatsApp and get this message approved before it can send.'}
            </p>
          ) : null}
          {children}
        </div>
      </Collapse>
    </div>
  );
}

export function RenewalRemindersSettings({
  onUnsavedChangesChange,
}: {
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
} = {}) {
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
  const sendingHoursRef = useRef<HTMLElement>(null);
  const [reveal, setReveal] = useState<RuleReveal | null>(null);
  const [sendingHoursReveal, setSendingHoursReveal] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, ReminderRulePatch>>({});
  const [sendingHoursDrafts, setSendingHoursDrafts] = useState<
    Record<string, LifecycleSendingHoursDraft>
  >({});
  const [dismissedLinkedRule, setDismissedLinkedRule] = useState<string | null>(
    null
  );
  const hasUnsavedRuleChanges = Object.entries(drafts).some(
    ([key, patch]) =>
      key.startsWith(`${draftScope}:`) && Object.keys(patch).length > 0
  );
  const sendingHoursDraft = sendingHoursDrafts[draftScope] ?? {};
  const hasUnsavedChanges =
    hasUnsavedRuleChanges || Object.keys(sendingHoursDraft).length > 0;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);
  useEffect(
    () => () => onUnsavedChangesChange?.(false),
    [onUnsavedChangesChange]
  );
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnsavedChanges]);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLinkNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download'))
        return;
      const destination = new URL(link.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (window.confirm(UNSAVED_CHANGES_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', warnBeforeLinkNavigation, true);
    return () =>
      document.removeEventListener('click', warnBeforeLinkNavigation, true);
  }, [hasUnsavedChanges]);
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
              message: data?.error || 'Automated messages could not load.',
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
              'Automated messages could not load. Try again.'
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
  useEffect(() => {
    if (!sendingHoursReveal || view !== 'rules' || loading) return;
    const editor = sendingHoursRef.current;
    if (!editor) return;
    (
      editor.querySelector<HTMLElement>(
        '[aria-label="Start sending at"]:not(:disabled)'
      ) ?? editor
    ).focus({ preventScroll: true });
    editor.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [loading, sendingHoursReveal, view]);
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
        start: Number(
          sendingHoursDraft.start ??
            invoiceCollection.settings.sendWindowStart ??
            9
        ),
        end: Number(
          sendingHoursDraft.end ??
            invoiceCollection.settings.sendWindowEnd ??
            19
        ),
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
  const goToSendingHours = () => {
    setView('rules');
    setSendingHoursReveal((current) => current + 1);
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
          data?.error || 'Automated message settings could not be saved.'
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
          'Automated message settings could not be saved. Try again.'
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
      <AlertTitle>Automated messages could not load</AlertTitle>
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
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            Ask the owner or an admin to change automated messages.
          </AlertDescription>
        </Alert>
      ) : null}
      {rules.some((rule) => !rule.readiness.ready) ? (
        <AutomatedMessageSetup
          rules={rules}
          canEdit={canEditSettings}
          blocker={EDIT_PERMISSION_BLOCKER}
          connectHref={branchHref('/settings?tab=whatsapp', browserBranchId())}
          accountId={accountId}
          onChanged={() => setReloadNonce((value) => value + 1)}
        />
      ) : null}
      {invoiceCollection && lifecycleWindow ? (
        <LifecycleSendingHoursSettings
          ref={sendingHoursRef}
          scopeKey={draftScope}
          value={{
            start: Number(invoiceCollection.settings.sendWindowStart ?? 9),
            end: Number(invoiceCollection.settings.sendWindowEnd ?? 19),
          }}
          draft={sendingHoursDraft}
          canEdit={canEditSettings}
          onDraftChange={(draft) =>
            setSendingHoursDrafts((current) => ({
              ...current,
              [draftScope]: draft,
            }))
          }
          onSave={(patch) => save('invoice_collection', patch)}
        />
      ) : null}
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
                  summary={timingSummary({
                    ...rule,
                    settings: {
                      ...rule.settings,
                      ...drafts[`${draftScope}:${rule.id}`],
                    },
                  })}
                  canEdit={canEditSettings}
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
                    onDraftChange={(patch) => {
                      const key = `${draftScope}:${rule.id}`;
                      const normalized = normalizeRulePatch(rule, patch);
                      setDrafts((current) => ({
                        ...current,
                        [key]: normalized,
                      }));
                    }}
                    onSave={save}
                    lifecycleWindow={lifecycleWindow}
                    hasUnsavedChanges={hasUnsavedChanges}
                    onOpenSendingHours={goToSendingHours}
                  />
                </RuleRow>
              ))}
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
  return (
    <>
      <section className="max-w-5xl">
        <SettingsPanelHead
          title="Automated messages"
          description="Choose which WhatsApp messages to send automatically."
        />
        {/* Messages and Message history are this panel's views, so their tabs sit under
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
                Messages
              </TabsTrigger>
              <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
                Message history
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
                <AlertTitle>You do not have permission</AlertTitle>
                <AlertDescription>
                  Ask the owner or an admin to check message history.
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
