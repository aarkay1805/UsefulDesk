'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { AutomatedMessageActivity } from '@/components/settings/automated-message-activity';
import { BubbleTail } from '@/components/inbox/message-bubble';
import { PageHeaderTabs } from '@/components/layout/page-header-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Collapse } from '@/components/ui/collapse';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResolvableAction } from '@/components/ui/resolvable-action';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import {
  BRANCH_HEADER,
  browserBranchId,
  branchHref,
} from '@/lib/auth/branch-context';
import { getErrorMessage } from '@/lib/errors';
import { timeInTzToUtc } from '@/lib/locale/format';
import {
  REMINDER_RULE_GROUPS,
  REMINDER_RULES,
  type ReminderRule,
  type ReminderRuleId,
  type ReminderRulePatch,
} from '@/lib/reminders/rules';
import { getTemplateContractById } from '@/lib/whatsapp/template-contracts';
import { useLocale } from '@/hooks/use-locale';
import { SettingsPanelHead } from './settings-panel-head';

type RuleRow = ReminderRule & {
  settings: Record<string, unknown>;
  readiness: {
    ready: boolean;
    code: string;
    message?: string;
    templateContractId?: (typeof REMINDER_RULES)[number]['templateContracts'][number];
  };
};

const GROUP_COPY = {
  renewals: 'Before and after a membership or service ends.',
  collections: 'Amounts that are due, overdue, or awaiting payment.',
  retention: 'Member moments where a timely message can bring them back.',
  confirmations: 'Receipts after a completed payment.',
} as const;

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
  { timing: string; eligibility: string; stops: string; staff: string }
> = {
  membership_renewal: {
    timing: 'Before a current membership ends.',
    eligibility:
      'Manually renewed, recurring active memberships with an upcoming end date and a member phone number.',
    stops: 'The membership is renewed, cancelled, or its end date changes.',
    staff: 'Handle renewal replies and follow up with members who need help.',
  },
  service_renewal: {
    timing: 'Before a current paid service ends.',
    eligibility:
      'Current services with an upcoming end date, current price, and a member phone number.',
    stops:
      'The service is renewed, cancelled, archived, or its end date changes.',
    staff: 'Handle service renewal replies and pricing questions.',
  },
  membership_post_expiry: {
    timing: 'On days 1, 3, and 7 after membership expiry.',
    eligibility: 'Expired memberships that have not changed since expiry.',
    stops:
      'The membership renews, is held, frozen, replaced, or the member replies.',
    staff:
      'An accepted day-7 reminder creates or links one branch-owner follow-up when there is no reply.',
  },
  service_post_expiry: {
    timing: 'On days 1, 3, and 7 after service expiry.',
    eligibility: 'Expired paid services that have not changed since expiry.',
    stops: 'The service renews, is held, replaced, or the member replies.',
    staff:
      'An accepted day-7 reminder creates or links one branch-owner follow-up when there is no reply.',
  },
  invoice_collection: {
    timing: 'Before due dates and on opted-in overdue milestones.',
    eligibility:
      'Open invoices with a due amount and a member phone number. Invoices without a due date use their issued date for both due and overdue milestones.',
    stops: 'The invoice is paid, voided, or its balance and due state change.',
    staff:
      'Resolve payment questions and record payments received outside the system.',
  },
  joining_installments: {
    timing: '7, 3, 1, and 0 days before each recorded installment due date.',
    eligibility:
      'A membership transaction with an unpaid installment and a member phone number.',
    stops:
      'The installment is paid, cancelled, or the transaction schedule changes.',
    staff:
      'Follow up on unpaid installments and update the transaction when payment arrives.',
  },
  promise_to_pay: {
    timing: '1 day before, on, and 1 day after a recorded promise due date.',
    eligibility:
      'An open payment commitment with a due date and member phone number.',
    stops: 'The promise is fulfilled, cancelled, or its due date changes.',
    staff: 'Contact members whose promise has passed without payment.',
  },
  payment_link_follow_up: {
    timing: '1 and 3 days after the payment link was accepted by the provider.',
    eligibility: 'An active unpaid payment link with a member phone number.',
    stops: 'The payment link is paid, expired, cancelled, or replaced.',
    staff: 'Resolve failed payment attempts or issue a new link.',
  },
  autopay_recovery: {
    timing: 'When AutoPay reports a retry or a terminal recovery outcome.',
    eligibility:
      'An AutoPay collection event with a matching member phone number.',
    stops:
      'A successful collection, a healthy mandate, or a changed provider outcome.',
    staff:
      'Review terminal failures and help the member choose the next payment step.',
  },
  session_pack: {
    timing: 'At 2 or fewer sessions remaining, and again at 0.',
    eligibility:
      'A current session pack with 2 or fewer sessions remaining, including 0.',
    stops: 'The member buys a new pack or the current pack balance changes.',
    staff: 'Reply with suitable pack options when the member asks.',
  },
  freeze_return: {
    timing:
      'One day before the planned return; staff follow-up is due on the return day.',
    eligibility: 'A frozen membership with an unchanged planned return date.',
    stops:
      'The membership returns, stays frozen with a new date, or is cancelled.',
    staff: 'Confirm the member’s next step before the planned return.',
  },
  membership_win_back: {
    timing: '14, 30, and 60 days after expiry, after the short sequence.',
    eligibility:
      'An unchanged expired membership that reaches the win-back milestone.',
    stops: 'A renewal, replacement cycle, hold, freeze, promise, or reply.',
    staff:
      'Handle replies manually; use current pricing without inventing offers.',
  },
  service_win_back: {
    timing: '14, 30, and 60 days after expiry, after the short sequence.',
    eligibility:
      'An unchanged expired paid service that reaches the win-back milestone.',
    stops: 'A renewal, replacement service, hold, promise, or reply.',
    staff: 'Handle replies using the current service price.',
  },
  payment_confirmation: {
    timing: 'After a committed payment recorded after this rule was activated.',
    eligibility: 'A completed payment with a member phone number.',
    stops:
      'The payment is reversed or no longer qualifies for a receipt notification.',
    staff: 'Investigate receipt questions or payment reversals.',
  },
};

function isEnabled(rule: RuleRow) {
  return rule.settings.enabled === true;
}

function status(rule: RuleRow) {
  if (isEnabled(rule) && !rule.readiness.ready)
    return { label: 'Blocked', variant: 'warning' as const };
  if (rule.readiness.ready)
    return { label: 'Ready', variant: 'success' as const };
  return { label: 'Needs setup', variant: 'neutral' as const };
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

function templateName(rule: RuleRow) {
  const contract = rule.templateContracts[0]
    ? getTemplateContractById(rule.templateContracts[0])
    : null;
  return contract?.payload.name ?? 'message template';
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

function TimingControls({
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
  const controls = rule.fields.filter(
    (field) => field.key !== 'enabled' && field.type !== 'boolean'
  );
  if (!controls.length)
    return (
      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">When:</span>{' '}
        {RULE_DETAILS[rule.id].timing}
      </p>
    );
  return (
    <div className="space-y-4">
      {controls.map((field) => {
        const value =
          draft[field.key] ?? rule.settings[field.key] ?? field.defaultValue;
        if (field.type === 'integer-array') {
          const choices = Array.from(
            new Set([0, 1, 2, 3, 7, 14, 30, ...(value as number[])])
          ).filter(
            (day) => day >= (field.min ?? 0) && day <= (field.max ?? 365)
          );
          return (
            <div className="space-y-2" key={field.key}>
              <Label>{field.label}</Label>
              <ChipGroup<string>
                selectionMode="multiple"
                value={(value as number[]).map(String)}
                onValueChange={(values) =>
                  onChange({
                    ...draft,
                    [field.key]: values.map(Number).sort((a, b) => b - a),
                  })
                }
                aria-label={`${rule.title} ${field.label}`}
              >
                {choices.map((day) => (
                  <Chip key={day} value={String(day)} disabled={disabled}>
                    {day === 0
                      ? 'On the day'
                      : `${day} day${day === 1 ? '' : 's'}`}
                  </Chip>
                ))}
              </ChipGroup>
            </div>
          );
        }
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
  return (
    <div className="space-y-5 pt-5" data-testid={`rule-detail-${rule.id}`}>
      <div className="space-y-1 text-sm">
        <p className="font-medium">Who qualifies</p>
        <p className="text-muted-foreground max-w-2xl">
          {RULE_DETAILS[rule.id].eligibility}
        </p>
      </div>
      {rule.id === 'joining_installments' ? (
        <Alert>
          <AlertTitle>Managed schedule</AlertTitle>
          <AlertDescription>
            Joining installments follow the membership payment schedule. They
            are not an independent toggle. Inspect a member’s Billing details
            for their recorded payment schedule.
          </AlertDescription>
          {!hasUnsavedChanges ? (
            <Button
              nativeButton={false}
              render={<Link href={branchHref('/members', browserBranchId())} />}
              variant="link"
              size="sm"
            >
              Open members
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <div className="space-y-1 text-sm">
        <p className="font-medium">When it sends</p>
        <p className="text-muted-foreground">{timingSummary(rule)}</p>
        {[
          'membership_renewal',
          'service_renewal',
          'joining_installments',
        ].includes(rule.id) ? (
          <p className="text-muted-foreground">
            From {localTime(9)} in this branch’s timezone.
          </p>
        ) : null}
      </div>
      {rule.id === 'autopay_recovery' ? (
        <Alert>
          <AlertTitle>AutoPay retry update</AlertTitle>
          <AlertDescription>
            Retry updates explain the next provider attempt and do not ask for
            manual payment or use the collection daily budget. Terminal failure
            messages request payment only after eligibility checks and reserve
            the shared collection daily budget.
          </AlertDescription>
        </Alert>
      ) : null}
      {usesLifecycleWindow && lifecycleWindow ? (
        <Alert>
          <AlertTitle>Lifecycle send window</AlertTitle>
          <AlertDescription>
            This rule uses the shared account-local window of{' '}
            {localTime(lifecycleWindow.start)} through{' '}
            {localTime(lifecycleWindow.end, '59')}, configured under Invoice
            collection.
          </AlertDescription>
          {rule.id === 'invoice_collection' ? null : !dirty ? (
            <Button variant="link" size="sm" onClick={onOpenInvoiceCollection}>
              Open Invoice collection timing
            </Button>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              Save or cancel this rule’s changes before opening Invoice
              collection timing.
            </p>
          )}
        </Alert>
      ) : null}
      <TimingControls
        rule={rule}
        draft={draft}
        onChange={onDraftChange}
        disabled={!canEdit || saving}
      />
      <div className="space-y-2">
        <Label>Sample message</Label>
        {rule.templateContracts.map((contractId) => {
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
            <div
              className="bg-chat-canvas relative overflow-hidden rounded-lg p-3"
              key={contractId}
            >
              <div
                aria-hidden
                className="chat-doodle pointer-events-none absolute inset-0"
              />
              <div className="bg-chat-bubble-in text-foreground relative w-fit max-w-[88%] rounded-lg rounded-tl-none p-2 text-sm whitespace-pre-wrap shadow-[var(--chat-bubble-shadow)]">
                <BubbleTail side="left" />
                {rule.templateContracts.length > 1 ? (
                  <p className="mb-2 font-medium">{contract?.title}</p>
                ) : null}
                {message}
                {contract?.payload.footer_text ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {contract.payload.footer_text}
                  </p>
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
              {!hasUnsavedChanges ? (
                <Link
                  className={buttonVariants({ variant: 'link', size: 'sm' })}
                  href={ruleHref(rule, contractId)}
                >
                  Open {contract?.payload.name ?? 'template'}
                </Link>
              ) : null}
            </div>
          );
        })}
        <p className="text-muted-foreground text-xs">
          Preview only. It never sends a message.
        </p>
      </div>
      <div className="space-y-1 text-sm">
        <p>
          <span className="font-medium">Stops when:</span>{' '}
          {RULE_DETAILS[rule.id].stops}
        </p>
        <p>
          <span className="font-medium">Staff follow-up:</span>{' '}
          {RULE_DETAILS[rule.id].staff}
        </p>
        {hasUnsavedChanges ? (
          <p className="text-muted-foreground text-xs">
            Save or cancel unsaved rule changes before opening template setup.
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => onDraftChange({})}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          loading={saving}
          disabled={!dirty || !canEdit}
          onClick={save}
        >
          Save changes
        </Button>
      </div>
      {!rule.readiness.ready ? (
        <p className="text-muted-foreground text-xs">
          Saving configuration never turns this rule on.
        </p>
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
  onSave,
}: {
  rule: RuleRow;
  canEdit: boolean;
  hasDraft: boolean;
  expanded: boolean;
  children: ReactNode;
  onOpen: () => void;
  onSave: (id: ReminderRuleId, patch: ReminderRulePatch) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const enabled = isEnabled(rule);
  const currentStatus = status(rule);
  const canToggle = rule.fields.some((field) => field.key === 'enabled');
  const blocker =
    !enabled && !rule.readiness.ready
      ? {
          title:
            rule.readiness.code === 'whatsapp_not_connected'
              ? 'WhatsApp isn’t connected'
              : 'This template needs setup',
          description:
            rule.readiness.message ??
            'Connect WhatsApp and approve the exact template before it can send.',
          ...(hasDraft
            ? {
                description:
                  'Save or cancel this rule’s changes before resolving setup.',
              }
            : {
                resolution: {
                  label:
                    rule.readiness.code === 'whatsapp_not_connected'
                      ? 'Open WhatsApp settings'
                      : `Open ${templateName(rule)}`,
                  href: setupHref(rule),
                },
              }),
        }
      : null;
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
  return (
    <div
      className="border-border border-b py-3 last:border-b-0"
      data-testid={`rule-row-${rule.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-48 flex-1">
          <p className="font-medium" id={`rule-title-${rule.id}`}>
            {rule.title}
          </p>
          <p className="text-muted-foreground text-sm">{timingSummary(rule)}</p>
        </div>
        {rule.id === 'joining_installments' ? (
          <Badge variant="neutral">Managed</Badge>
        ) : (
          <Badge variant={enabled ? 'success' : 'neutral'}>
            {enabled ? 'On' : 'Off'}
          </Badge>
        )}
        <Badge variant={currentStatus.variant}>{currentStatus.label}</Badge>
        <div className="flex items-center gap-2">
          {canToggle ? (
            <>
              <ResolvableAction
                blocker={blocker}
                triggerNativeButton={false}
                onAction={toggle}
                trigger={
                  <Switch
                    checked={enabled}
                    disabled={!canEdit || saving}
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
          ) : (
            <Badge variant="neutral">Scheduled</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onOpen}
            id={`rule-configure-${rule.id}`}
            aria-expanded={expanded}
            aria-controls={`rule-panel-${rule.id}`}
          >
            {expanded ? 'Close' : 'Configure'}
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </div>
      <Collapse open={expanded}>
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
  const searchParams = useSearchParams();
  const branchParam = searchParams.get('branch');
  const draftScope = `${accountId ?? 'anonymous'}:${branchParam ?? 'primary'}`;
  const [view, setView] = useState('rules');
  const [group, setGroup] = useState<keyof typeof GROUP_COPY>('renewals');
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [selectedId, setSelectedId] = useState<ReminderRuleId | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReminderRulePatch>>({});
  const [dismissedLinkedRule, setDismissedLinkedRule] = useState<string | null>(
    null
  );
  const hasUnsavedChanges = Object.entries(drafts).some(
    ([key, patch]) =>
      key.startsWith(`${draftScope}:`) && Object.keys(patch).length > 0
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        if (!response.ok)
          throw new Error(data?.error || 'Automated messages couldn’t load.');
        if (!cancelled) setRules(data.rules ?? []);
      } catch (loadError) {
        if (!cancelled)
          setError(
            getErrorMessage(
              loadError,
              'Automated messages couldn’t load. Try again.'
            )
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchParam, reloadNonce]);
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
  const activeGroup =
    !selectedId && linkedRuleId && dismissedLinkedRule !== linkedRuleId
      ? (selected?.group ?? group)
      : group;
  const visible = useMemo(
    () => rules.filter((rule) => rule.group === activeGroup),
    [activeGroup, rules]
  );
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
  if (loading)
    return (
      <section className="max-w-5xl">
        <SettingsPanelHead
          title="Automated messages"
          description="Manage the messages UsefulDesk can send for member events."
        />
        <div
          className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          Loading automated messages…
        </div>
      </section>
    );
  if (error)
    return (
      <section className="max-w-5xl">
        <SettingsPanelHead
          title="Automated messages"
          description="Manage the messages UsefulDesk can send for member events."
        />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Automated messages couldn’t load</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="destructive"
              onClick={() => setReloadNonce((value) => value + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  return (
    <Tabs value={view} onValueChange={setView}>
      <PageHeaderTabs>
        <TabsList variant="line" aria-label="Automated messages">
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </PageHeaderTabs>
      <section className="max-w-5xl space-y-4">
        <SettingsPanelHead
          title="Automated messages"
          description="Choose which member events can send an approved WhatsApp message."
        />
        {!canEditSettings ? (
          <Alert>
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>
              Only admins and owners can change automated messages.
            </AlertDescription>
          </Alert>
        ) : null}
        <TabsContent value="rules" className="space-y-4">
          <ChipGroup<string>
            selectionMode="single"
            value={[activeGroup]}
            onValueChange={(value) => {
              if (!value[0]) return;
              setGroup(value[0] as keyof typeof GROUP_COPY);
              setSelectedId(null);
              setDismissedLinkedRule(linkedRuleId);
            }}
            aria-label="Message group"
          >
            {REMINDER_RULE_GROUPS.map((entry) => (
              <Chip key={entry} value={entry}>
                {entry[0].toUpperCase() + entry.slice(1)}
              </Chip>
            ))}
          </ChipGroup>
          <p className="text-muted-foreground text-sm">
            {GROUP_COPY[activeGroup]}
          </p>
          <Card>
            <CardContent>
              {visible.map((rule) => (
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
                      setGroup(rule.group);
                      setDismissedLinkedRule(null);
                    }
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
                    onOpenInvoiceCollection={() => {
                      setSelectedId('invoice_collection');
                      setGroup('collections');
                      setDismissedLinkedRule(null);
                    }}
                  />
                </RuleRow>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="activity">
          <AutomatedMessageActivity
            onReviewRule={(id) => {
              const rule = rules.find((item) => item.id === id);
              if (!rule) return;
              setSelectedId(rule.id);
              setGroup(rule.group);
              setDismissedLinkedRule(null);
              setView('rules');
            }}
          />
        </TabsContent>
      </section>
    </Tabs>
  );
}
