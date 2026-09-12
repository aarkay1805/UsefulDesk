'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Collapse } from '@/components/ui/collapse';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { BRANCH_HEADER, browserBranchId } from '@/lib/auth/branch-context';
import { getErrorMessage } from '@/lib/errors';
import {
  DEFAULT_DAYS_BEFORE,
  normalizeDaysBefore,
} from '@/lib/memberships/renewal-reminders';
import type { ReminderDiagnostic } from '@/lib/memberships/reminder-readiness';
import { createClient } from '@/lib/supabase/client';
import {
  FEATURE_TEMPLATE_CONTRACTS,
  getTemplateContractById,
  type TemplateContractId,
} from '@/lib/whatsapp/template-contracts';
import {
  evaluateTemplateReadiness,
  type TemplateReadinessRow,
} from '@/lib/whatsapp/template-readiness';
import { PageHeaderTabs } from '@/components/layout/page-header-actions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsPanelHead } from './settings-panel-head';

const PANEL_DESCRIPTION =
  'Manage automatic WhatsApp messages for renewals, payments, and member retention.';

/** The cron accepts any offset, but these choices cover the useful cadence. */
const OFFSET_CHOICES: { value: number; label: string }[] = [
  { value: 14, label: '14 days before' },
  { value: 7, label: '7 days before' },
  { value: 3, label: '3 days before' },
  { value: 1, label: '1 day before' },
  { value: 0, label: 'On expiry day' },
];

interface ReminderConfig {
  enabled: boolean;
  offsets: number[];
  serviceEnabled: boolean;
  serviceOffsets: number[];
  invoiceCollectionEnabled: boolean;
  invoiceBeforeDueDays: number[];
  invoiceOverdueDays: number[];
  invoiceSendWindowStart: number;
  invoiceSendWindowEnd: number;
  membershipPostExpiryEnabled: boolean;
  servicePostExpiryEnabled: boolean;
  promiseToPayRemindersEnabled: boolean;
  paymentLinkFollowUpEnabled: boolean;
  paymentConfirmationsEnabled: boolean;
  autopayRecoveryEnabled: boolean;
  sessionPackRemindersEnabled: boolean;
  freezeReturnRemindersEnabled: boolean;
  membershipWinBackEnabled: boolean;
  serviceWinBackEnabled: boolean;
}

interface SetupStatus {
  ready: boolean;
  badge: string;
  title: string;
  description: string;
  href: string;
  action: string;
}

interface ReminderHistoryEntry {
  state: 'accepted' | 'blocked' | 'skipped';
  created_at: string;
  reason: { code?: string } | null;
  escalation_state?:
    'created' | 'existing' | 'owner_unavailable' | 'replied' | null;
}

const DIAGNOSTIC_LABELS: Record<ReminderDiagnostic['kind'], string> = {
  membership_renewal: 'Membership renewal',
  service_renewal: 'Service renewal',
  installment_reminder: 'Joining installment',
};

function diagnosticBadge(state: ReminderDiagnostic['state']) {
  switch (state) {
    case 'ready':
      return { label: 'Eligible now', variant: 'success' as const };
    case 'no_eligible':
      return { label: 'Nothing due', variant: 'neutral' as const };
    case 'disabled':
      return { label: 'Off', variant: 'neutral' as const };
    case 'blocked':
      return { label: 'Blocked', variant: 'warning' as const };
    case 'deferred':
      return { label: 'Waiting', variant: 'info' as const };
  }
}

function diagnosticDetail(diagnostic: ReminderDiagnostic) {
  const details = [`${diagnostic.dateMatchedCount} date-matched`];
  if (diagnostic.pendingCount > 0) {
    details.push(`${diagnostic.pendingCount} sendable now`);
  }
  if (diagnostic.deferredCount > 0) {
    details.push(`${diagnostic.deferredCount} waiting for send window`);
  }
  if (diagnostic.blockedCount > 0) {
    details.push(`${diagnostic.blockedCount} missing phone`);
  }
  return details.join(' · ');
}

function configKey(config: ReminderConfig) {
  return JSON.stringify({
    enabled: config.enabled,
    offsets: normalizeDaysBefore(config.offsets),
    serviceEnabled: config.serviceEnabled,
    serviceOffsets: normalizeDaysBefore(config.serviceOffsets),
    invoiceCollectionEnabled: config.invoiceCollectionEnabled,
    invoiceBeforeDueDays: normalizeDaysBefore(config.invoiceBeforeDueDays),
    invoiceOverdueDays: normalizeDaysBefore(config.invoiceOverdueDays),
    invoiceSendWindowStart: config.invoiceSendWindowStart,
    invoiceSendWindowEnd: config.invoiceSendWindowEnd,
    membershipPostExpiryEnabled: config.membershipPostExpiryEnabled,
    servicePostExpiryEnabled: config.servicePostExpiryEnabled,
    promiseToPayRemindersEnabled: config.promiseToPayRemindersEnabled,
    paymentLinkFollowUpEnabled: config.paymentLinkFollowUpEnabled,
    paymentConfirmationsEnabled: config.paymentConfirmationsEnabled,
    autopayRecoveryEnabled: config.autopayRecoveryEnabled,
    sessionPackRemindersEnabled: config.sessionPackRemindersEnabled,
    freezeReturnRemindersEnabled: config.freezeReturnRemindersEnabled,
    membershipWinBackEnabled: config.membershipWinBackEnabled,
    serviceWinBackEnabled: config.serviceWinBackEnabled,
  });
}

function resolveContractSetupStatus(
  whatsappConnected: boolean,
  templates: readonly TemplateReadinessRow[],
  contractId: TemplateContractId
): SetupStatus {
  const contract = getTemplateContractById(contractId);
  if (!contract) throw new Error(`Unknown template contract: ${contractId}`);

  if (!whatsappConnected) {
    return {
      ready: false,
      badge: 'WhatsApp needed',
      title: 'WhatsApp isn’t connected',
      description:
        'Connect this branch’s WhatsApp account before reminders can send.',
      href: '/settings?tab=whatsapp',
      action: 'Open WhatsApp settings',
    };
  }

  const readiness = evaluateTemplateReadiness(templates, contractId, 'en_US');
  if (!readiness.ready) {
    return {
      ready: false,
      badge: readiness.code === 'pending' ? 'Approval pending' : 'Needs setup',
      title: `${contract.title} template isn’t ready`,
      description: readiness.message,
      href: '/settings?tab=templates',
      action: 'Open Templates',
    };
  }

  return {
    ready: true,
    badge: 'Ready',
    title: '',
    description: '',
    href: '',
    action: '',
  };
}

function ReminderSchedule({
  labelId,
  offsets,
  onChange,
  disabled,
}: {
  labelId: string;
  offsets: number[];
  onChange: (offsets: number[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label id={labelId}>Send reminders</Label>
      <ChipGroup<string>
        selectionMode="multiple"
        value={offsets.map(String)}
        onValueChange={(values) =>
          onChange(normalizeDaysBefore(values.map(Number)))
        }
        aria-labelledby={labelId}
      >
        {OFFSET_CHOICES.map((choice) => (
          <Chip
            key={choice.value}
            value={String(choice.value)}
            disabled={disabled}
          >
            {choice.label}
          </Chip>
        ))}
      </ChipGroup>
      <p className="text-muted-foreground max-w-[70ch] text-xs">
        Sent after 9:00 AM in this branch’s time zone. Each selected day sends
        once per expiry.
      </p>
    </div>
  );
}

function InvoiceSchedule({
  beforeDueDays,
  overdueDays,
  onBeforeDueChange,
  onOverdueChange,
  disabled,
}: {
  beforeDueDays: number[];
  overdueDays: number[];
  onBeforeDueChange: (days: number[]) => void;
  onOverdueChange: (days: number[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label id="invoice-before-due-schedule">Due milestones</Label>
        <p className="text-muted-foreground text-sm">
          Generic invoices use their issued date as the effective due date, so
          only “On due date” can run until invoices have a real due date.
        </p>
        <ChipGroup<string>
          selectionMode="multiple"
          value={beforeDueDays.map(String)}
          onValueChange={(values) =>
            onBeforeDueChange(normalizeDaysBefore(values.map(Number)))
          }
          aria-labelledby="invoice-before-due-schedule"
        >
          {[3, 1, 0].map((days) => (
            <Chip key={days} value={String(days)} disabled={disabled}>
              {days === 0
                ? 'On due date'
                : `${days} day${days === 1 ? '' : 's'} before`}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <div className="space-y-2">
        <Label id="invoice-overdue-schedule">Overdue milestones</Label>
        <ChipGroup<string>
          selectionMode="multiple"
          value={overdueDays.map(String)}
          onValueChange={(values) =>
            onOverdueChange(normalizeDaysBefore(values.map(Number)))
          }
          aria-labelledby="invoice-overdue-schedule"
        >
          {[1, 3, 7, 14].map((days) => (
            <Chip key={days} value={String(days)} disabled={disabled}>
              {`${days} day${days === 1 ? '' : 's'} overdue`}
            </Chip>
          ))}
        </ChipGroup>
      </div>
    </div>
  );
}

/** Automatic member messaging settings; state survives view changes. */
export function RenewalRemindersSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [view, setView] = useState('controls');
  const [category, setCategory] = useState('renewals');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [enabled, setEnabled] = useState(false);
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_DAYS_BEFORE);
  const [serviceEnabled, setServiceEnabled] = useState(false);
  const [serviceOffsets, setServiceOffsets] =
    useState<number[]>(DEFAULT_DAYS_BEFORE);
  const [invoiceCollectionEnabled, setInvoiceCollectionEnabled] =
    useState(false);
  const [invoiceBeforeDueDays, setInvoiceBeforeDueDays] = useState<number[]>([
    3, 1, 0,
  ]);
  const [invoiceOverdueDays, setInvoiceOverdueDays] = useState<number[]>([
    1, 3, 7, 14,
  ]);
  const [invoiceSendWindowStart, setInvoiceSendWindowStart] = useState(9);
  const [invoiceSendWindowEnd, setInvoiceSendWindowEnd] = useState(19);
  const [membershipPostExpiryEnabled, setMembershipPostExpiryEnabled] =
    useState(false);
  const [servicePostExpiryEnabled, setServicePostExpiryEnabled] =
    useState(false);
  const [promiseToPayRemindersEnabled, setPromiseToPayRemindersEnabled] =
    useState(false);
  const [paymentLinkFollowUpEnabled, setPaymentLinkFollowUpEnabled] =
    useState(false);
  const [paymentConfirmationsEnabled, setPaymentConfirmationsEnabled] =
    useState(false);
  const [autopayRecoveryEnabled, setAutopayRecoveryEnabled] = useState(false);
  const [sessionPackRemindersEnabled, setSessionPackRemindersEnabled] =
    useState(false);
  const [freezeReturnRemindersEnabled, setFreezeReturnRemindersEnabled] =
    useState(false);
  const [membershipWinBackEnabled, setMembershipWinBackEnabled] =
    useState(false);
  const [serviceWinBackEnabled, setServiceWinBackEnabled] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [templates, setTemplates] = useState<TemplateReadinessRow[]>([]);
  const [diagnostics, setDiagnostics] = useState<ReminderDiagnostic[]>([]);
  const [reminderHistory, setReminderHistory] = useState<
    ReminderHistoryEntry[]
  >([]);
  const [savedConfigKey, setSavedConfigKey] = useState('');

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      const branchId = browserBranchId();

      const [
        settingsResult,
        templatesResult,
        whatsappResult,
        diagnosticsResult,
        historyResult,
      ] = await Promise.all([
        supabase
          .from('renewal_reminder_settings')
          .select(
            'enabled, days_before, service_enabled, service_days_before, invoice_collection_enabled, invoice_collection_before_due_days, invoice_collection_overdue_days, invoice_collection_send_window_start, invoice_collection_send_window_end, membership_post_expiry_enabled, service_post_expiry_enabled, promise_to_pay_reminders_enabled, payment_link_follow_up_enabled, payment_confirmations_enabled, autopay_recovery_enabled, session_pack_reminders_enabled, freeze_return_reminders_enabled, membership_win_back_enabled, service_win_back_enabled'
          )
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .in(
            'name',
            FEATURE_TEMPLATE_CONTRACTS.map((contract) => contract.payload.name)
          ),
        supabase
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', accountId)
          .maybeSingle(),
        fetch('/api/reminders/readiness', {
          cache: 'no-store',
          headers: branchId ? { [BRANCH_HEADER]: branchId } : undefined,
        })
          .then(async (response) => {
            if (!response.ok) return null;
            return (await response.json()) as {
              diagnostics?: ReminderDiagnostic[];
            };
          })
          .catch(() => null),
        supabase
          .from('lifecycle_reminder_jobs')
          .select('state, created_at, reason, escalation_state')
          .eq('account_id', accountId)
          .in('state', ['blocked', 'accepted', 'skipped']),
      ]);
      if (cancelled) return;

      const firstError =
        settingsResult.error ?? templatesResult.error ?? whatsappResult.error;
      if (firstError) {
        setLoadError(
          getErrorMessage(
            firstError,
            'Reminder settings couldn’t load. Try again.'
          )
        );
        setLoading(false);
        return;
      }

      const data = settingsResult.data;
      const nextConfig: ReminderConfig = {
        enabled: Boolean(data?.enabled),
        offsets:
          normalizeDaysBefore(data?.days_before).length > 0
            ? normalizeDaysBefore(data?.days_before)
            : DEFAULT_DAYS_BEFORE,
        serviceEnabled: Boolean(data?.service_enabled),
        serviceOffsets:
          normalizeDaysBefore(data?.service_days_before).length > 0
            ? normalizeDaysBefore(data?.service_days_before)
            : DEFAULT_DAYS_BEFORE,
        invoiceCollectionEnabled: Boolean(data?.invoice_collection_enabled),
        invoiceBeforeDueDays:
          normalizeDaysBefore(data?.invoice_collection_before_due_days).length >
          0
            ? normalizeDaysBefore(data?.invoice_collection_before_due_days)
            : [3, 1, 0],
        invoiceOverdueDays:
          normalizeDaysBefore(data?.invoice_collection_overdue_days).length > 0
            ? normalizeDaysBefore(data?.invoice_collection_overdue_days)
            : [1, 3, 7, 14],
        invoiceSendWindowStart: Number(
          data?.invoice_collection_send_window_start ?? 9
        ),
        invoiceSendWindowEnd: Number(
          data?.invoice_collection_send_window_end ?? 19
        ),
        membershipPostExpiryEnabled: Boolean(
          data?.membership_post_expiry_enabled
        ),
        servicePostExpiryEnabled: Boolean(data?.service_post_expiry_enabled),
        promiseToPayRemindersEnabled: Boolean(
          data?.promise_to_pay_reminders_enabled
        ),
        paymentLinkFollowUpEnabled: Boolean(
          data?.payment_link_follow_up_enabled
        ),
        paymentConfirmationsEnabled: Boolean(
          data?.payment_confirmations_enabled
        ),
        autopayRecoveryEnabled: Boolean(data?.autopay_recovery_enabled),
        sessionPackRemindersEnabled: Boolean(
          data?.session_pack_reminders_enabled
        ),
        freezeReturnRemindersEnabled: Boolean(
          data?.freeze_return_reminders_enabled
        ),
        membershipWinBackEnabled: Boolean(data?.membership_win_back_enabled),
        serviceWinBackEnabled: Boolean(data?.service_win_back_enabled),
      };
      const templates = templatesResult.data ?? [];

      setEnabled(nextConfig.enabled);
      setOffsets(nextConfig.offsets);
      setServiceEnabled(nextConfig.serviceEnabled);
      setServiceOffsets(nextConfig.serviceOffsets);
      setInvoiceCollectionEnabled(nextConfig.invoiceCollectionEnabled);
      setInvoiceBeforeDueDays(nextConfig.invoiceBeforeDueDays);
      setInvoiceOverdueDays(nextConfig.invoiceOverdueDays);
      setInvoiceSendWindowStart(nextConfig.invoiceSendWindowStart);
      setInvoiceSendWindowEnd(nextConfig.invoiceSendWindowEnd);
      setMembershipPostExpiryEnabled(nextConfig.membershipPostExpiryEnabled);
      setServicePostExpiryEnabled(nextConfig.servicePostExpiryEnabled);
      setPromiseToPayRemindersEnabled(nextConfig.promiseToPayRemindersEnabled);
      setPaymentLinkFollowUpEnabled(nextConfig.paymentLinkFollowUpEnabled);
      setPaymentConfirmationsEnabled(nextConfig.paymentConfirmationsEnabled);
      setAutopayRecoveryEnabled(nextConfig.autopayRecoveryEnabled);
      setSessionPackRemindersEnabled(nextConfig.sessionPackRemindersEnabled);
      setFreezeReturnRemindersEnabled(nextConfig.freezeReturnRemindersEnabled);
      setMembershipWinBackEnabled(nextConfig.membershipWinBackEnabled);
      setServiceWinBackEnabled(nextConfig.serviceWinBackEnabled);
      setWhatsappConnected(whatsappResult.data?.status === 'connected');
      setTemplates(templates);
      setDiagnostics(diagnosticsResult?.diagnostics ?? []);
      setReminderHistory(
        ((historyResult.data ?? []) as ReminderHistoryEntry[])
          .filter(
            (entry): entry is ReminderHistoryEntry =>
              entry.state === 'blocked' || entry.state === 'accepted'
          )
          .slice(0, 5)
      );
      setSavedConfigKey(configKey(nextConfig));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, supabase, reloadNonce]);

  const currentConfig = {
    enabled,
    offsets,
    serviceEnabled,
    serviceOffsets,
    invoiceCollectionEnabled,
    invoiceBeforeDueDays,
    invoiceOverdueDays,
    invoiceSendWindowStart,
    invoiceSendWindowEnd,
    membershipPostExpiryEnabled,
    servicePostExpiryEnabled,
    promiseToPayRemindersEnabled,
    paymentLinkFollowUpEnabled,
    paymentConfirmationsEnabled,
    autopayRecoveryEnabled,
    sessionPackRemindersEnabled,
    freezeReturnRemindersEnabled,
    membershipWinBackEnabled,
    serviceWinBackEnabled,
  };
  const hasChanges = savedConfigKey !== configKey(currentConfig);
  const featureStatuses = FEATURE_TEMPLATE_CONTRACTS.map((contract) => ({
    contract,
    status: resolveContractSetupStatus(
      whatsappConnected,
      templates,
      contract.id
    ),
  }));

  async function handleSave() {
    if (!accountId || !canEditSettings) return;
    const clean = normalizeDaysBefore(offsets);
    const serviceClean = normalizeDaysBefore(serviceOffsets);
    if (enabled && clean.length === 0) {
      toast.error('Choose at least one membership reminder day.');
      return;
    }
    if (serviceEnabled && serviceClean.length === 0) {
      toast.error('Choose at least one service reminder day.');
      return;
    }
    const invoiceBeforeDueClean = normalizeDaysBefore(invoiceBeforeDueDays);
    const invoiceOverdueClean = normalizeDaysBefore(invoiceOverdueDays);
    if (invoiceCollectionEnabled && invoiceBeforeDueClean.length === 0) {
      toast.error('Choose at least one invoice due milestone.');
      return;
    }
    if (invoiceCollectionEnabled && invoiceOverdueClean.length === 0) {
      toast.error('Choose at least one overdue invoice milestone.');
      return;
    }
    if (
      !Number.isInteger(invoiceSendWindowStart) ||
      !Number.isInteger(invoiceSendWindowEnd) ||
      invoiceSendWindowStart < 0 ||
      invoiceSendWindowEnd > 23 ||
      invoiceSendWindowStart > invoiceSendWindowEnd
    ) {
      toast.error('Choose a valid local invoice reminder send window.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('renewal_reminder_settings')
        .upsert(
          {
            account_id: accountId,
            enabled,
            days_before: clean,
            service_enabled: serviceEnabled,
            service_days_before: serviceClean,
            invoice_collection_enabled: invoiceCollectionEnabled,
            invoice_collection_before_due_days: invoiceBeforeDueClean,
            invoice_collection_overdue_days: invoiceOverdueClean,
            invoice_collection_send_window_start: invoiceSendWindowStart,
            invoice_collection_send_window_end: invoiceSendWindowEnd,
            membership_post_expiry_enabled: membershipPostExpiryEnabled,
            service_post_expiry_enabled: servicePostExpiryEnabled,
            promise_to_pay_reminders_enabled: promiseToPayRemindersEnabled,
            payment_link_follow_up_enabled: paymentLinkFollowUpEnabled,
            payment_confirmations_enabled: paymentConfirmationsEnabled,
            autopay_recovery_enabled: autopayRecoveryEnabled,
            session_pack_reminders_enabled: sessionPackRemindersEnabled,
            freeze_return_reminders_enabled: freezeReturnRemindersEnabled,
            membership_win_back_enabled: membershipWinBackEnabled,
            service_win_back_enabled: serviceWinBackEnabled,
          },
          { onConflict: 'account_id' }
        )
        .select('account_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Reminder settings were not updated.');

      setOffsets(clean);
      setServiceOffsets(serviceClean);
      setSavedConfigKey(
        configKey({
          enabled,
          offsets: clean,
          serviceEnabled,
          serviceOffsets: serviceClean,
          invoiceCollectionEnabled,
          invoiceBeforeDueDays: invoiceBeforeDueClean,
          invoiceOverdueDays: invoiceOverdueClean,
          invoiceSendWindowStart,
          invoiceSendWindowEnd,
          membershipPostExpiryEnabled,
          servicePostExpiryEnabled,
          promiseToPayRemindersEnabled,
          paymentLinkFollowUpEnabled,
          paymentConfirmationsEnabled,
          autopayRecoveryEnabled,
          sessionPackRemindersEnabled,
          freezeReturnRemindersEnabled,
          membershipWinBackEnabled,
          serviceWinBackEnabled,
        })
      );
      toast.success('Reminder settings saved');
    } catch (error) {
      toast.error(
        getErrorMessage(
          error,
          'Reminder settings couldn’t be saved. Try again.'
        )
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 max-w-5xl duration-200">
        <SettingsPanelHead
          title="Reminders & messages"
          description={PANEL_DESCRIPTION}
        />
        <div
          className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading reminder settings…
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="animate-in fade-in-50 max-w-5xl duration-200">
        <SettingsPanelHead
          title="Reminders & messages"
          description={PANEL_DESCRIPTION}
        />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Reminder settings couldn’t load</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-3"
              onClick={() => setReloadNonce((nonce) => nonce + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <Tabs value={view} onValueChange={(value) => setView(String(value))}>
      <PageHeaderTabs>
        <TabsList variant="line" aria-label="Reminders & messages">
          <TabsTrigger value="controls">Messages</TabsTrigger>
          <TabsTrigger value="setup">Template setup</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </PageHeaderTabs>
      <section className="animate-in fade-in-50 max-w-5xl duration-200">
        <SettingsPanelHead
          title="Reminders & messages"
          description={PANEL_DESCRIPTION}
        />

        <div className="space-y-4">
          {!canEditSettings ? (
            <Alert>
              <AlertTitle>Read-only</AlertTitle>
              <AlertDescription>
                Only admins and owners can change reminder schedules.
              </AlertDescription>
            </Alert>
          ) : null}

          <TabsContent value="controls" className="space-y-4">
            <ChipGroup<string>
              selectionMode="single"
              value={[category]}
              onValueChange={(values) => {
                if (values[0]) setCategory(values[0]);
              }}
              aria-label="Message type"
            >
              <Chip value="renewals">Renewals</Chip>
              <Chip value="payments">Payments</Chip>
              <Chip value="retention">Retention</Chip>
            </ChipGroup>
            {featureStatuses.some(({ status }) => !status.ready) ? (
              <Alert>
                <AlertTitle>Some messages need setup</AlertTitle>
                <AlertDescription>
                  <p>
                    Turning a message on saves your preference. It can send only
                    after WhatsApp is connected and its template is approved and
                    synced.
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setView('setup')}
                  >
                    Review template setup
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {category === 'renewals' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Membership reminders
                      <Badge variant={enabled ? 'success' : 'neutral'}>
                        {enabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={enabled}
                        onCheckedChange={setEnabled}
                        disabled={!canEditSettings}
                        aria-label="Membership renewal reminders"
                        aria-describedby="membership-reminders-description"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p
                      id="membership-reminders-description"
                      className="text-muted-foreground text-sm"
                    >
                      Message members before their membership expires.
                    </p>
                    <Collapse open={enabled}>
                      <ReminderSchedule
                        labelId="membership-reminder-schedule"
                        offsets={offsets}
                        onChange={setOffsets}
                        disabled={!canEditSettings}
                      />
                    </Collapse>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Service reminders
                      <Badge variant={serviceEnabled ? 'success' : 'neutral'}>
                        {serviceEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={serviceEnabled}
                        onCheckedChange={setServiceEnabled}
                        disabled={!canEditSettings}
                        aria-label="Service renewal reminders"
                        aria-describedby="service-reminders-description"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p
                      id="service-reminders-description"
                      className="text-muted-foreground text-sm"
                    >
                      Message members before a renewable service expires.
                      Services without a current trainer fee are skipped.
                    </p>
                    <Collapse open={serviceEnabled}>
                      <ReminderSchedule
                        labelId="service-reminder-schedule"
                        offsets={serviceOffsets}
                        onChange={setServiceOffsets}
                        disabled={!canEditSettings}
                      />
                    </Collapse>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Post-expiry membership follow-up
                      <Badge
                        variant={
                          membershipPostExpiryEnabled ? 'success' : 'neutral'
                        }
                      >
                        {membershipPostExpiryEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={membershipPostExpiryEnabled}
                        onCheckedChange={setMembershipPostExpiryEnabled}
                        disabled={!canEditSettings}
                        aria-label="Post-expiry membership follow-up"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Follow up at 1, 3, and 7 days after an unchanged expired
                      membership. A current AutoPay membership, renewed cycle,
                      reply, frozen/cancelled membership, or non-recurring plan
                      stops the sequence.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      The last unanswered reminder creates one owner task; an
                      existing open follow-up stays untouched. This new schedule
                      starts with cycles that expire after it is enabled.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Post-expiry service follow-up
                      <Badge
                        variant={
                          servicePostExpiryEnabled ? 'success' : 'neutral'
                        }
                      >
                        {servicePostExpiryEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={servicePostExpiryEnabled}
                        onCheckedChange={setServicePostExpiryEnabled}
                        disabled={!canEditSettings}
                        aria-label="Post-expiry service follow-up"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Follow up at 1, 3, and 7 days after a renewable service
                      expires. An archived service or missing current rate is
                      held instead of sent.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Membership and service reminders share one member-level
                      daily contact limit. This new schedule starts with cycles
                      that expire after it is enabled.
                    </p>
                  </CardContent>
                </Card>
              </div>
            ) : null}
            {category === 'payments' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Invoice collection
                      <Badge
                        variant={
                          invoiceCollectionEnabled ? 'success' : 'neutral'
                        }
                      >
                        {invoiceCollectionEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={invoiceCollectionEnabled}
                        onCheckedChange={setInvoiceCollectionEnabled}
                        disabled={!canEditSettings}
                        aria-label="Invoice collection reminders"
                        aria-describedby="invoice-collection-description"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p
                      id="invoice-collection-description"
                      className="text-muted-foreground text-sm"
                    >
                      Collect only an open invoice&apos;s current remaining
                      balance. This schedule starts with invoices issued after
                      you turn it on; because generic invoices do not store a
                      due date, the issued date is the effective due date. Fixed
                      joining installments keep their own promised due date.
                    </p>
                    <Collapse open={invoiceCollectionEnabled}>
                      <div className="space-y-4">
                        <InvoiceSchedule
                          beforeDueDays={invoiceBeforeDueDays}
                          overdueDays={invoiceOverdueDays}
                          onBeforeDueChange={setInvoiceBeforeDueDays}
                          onOverdueChange={setInvoiceOverdueDays}
                          disabled={!canEditSettings}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="invoice-send-window-start">
                              Send from
                            </Label>
                            <Input
                              id="invoice-send-window-start"
                              type="number"
                              min={0}
                              max={23}
                              value={invoiceSendWindowStart}
                              disabled={!canEditSettings}
                              onChange={(event) =>
                                setInvoiceSendWindowStart(
                                  Number(event.target.value)
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="invoice-send-window-end">
                              Send until
                            </Label>
                            <Input
                              id="invoice-send-window-end"
                              type="number"
                              min={0}
                              max={23}
                              value={invoiceSendWindowEnd}
                              disabled={!canEditSettings}
                              onChange={(event) =>
                                setInvoiceSendWindowEnd(
                                  Number(event.target.value)
                                )
                              }
                            />
                          </div>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          Account-local hours, inclusive. Default: 09:00–19:00.
                          Missing phone numbers, WhatsApp connection, or exact
                          templates stay visible as blocked jobs rather than
                          being counted as sent. This lifecycle window also
                          governs enabled post-expiry recovery.
                        </p>
                      </div>
                    </Collapse>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Promise-to-pay reminders
                      <Badge
                        variant={
                          promiseToPayRemindersEnabled ? 'success' : 'neutral'
                        }
                      >
                        {promiseToPayRemindersEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={promiseToPayRemindersEnabled}
                        onCheckedChange={setPromiseToPayRemindersEnabled}
                        disabled={!canEditSettings}
                        aria-label="Promise-to-pay reminders"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Send one reminder the day before and on the exact
                      staff-recorded promise date. A payment allocation that
                      meets the promised amount fulfils it; an underpayment
                      leaves the residual obligation open.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      A broken promise creates one staff follow-up. This
                      schedule starts only with commitments recorded after it is
                      enabled.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Payment-link follow-up
                      <Badge
                        variant={
                          paymentLinkFollowUpEnabled ? 'success' : 'neutral'
                        }
                      >
                        {paymentLinkFollowUpEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={paymentLinkFollowUpEnabled}
                        onCheckedChange={setPaymentLinkFollowUpEnabled}
                        disabled={!canEditSettings}
                        aria-label="Payment-link follow-up"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Follow up 1 and 3 days after an accepted WhatsApp
                      payment-link send, only while the exact link is active,
                      unexpired, and still matches the current unpaid balance.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Expired or changed links become a staff action to create a
                      replacement through the existing payment-link flow; this
                      worker never creates a provider link.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Failed AutoPay recovery
                      <Badge
                        variant={autopayRecoveryEnabled ? 'success' : 'neutral'}
                      >
                        {autopayRecoveryEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={autopayRecoveryEnabled}
                        onCheckedChange={setAutopayRecoveryEnabled}
                        disabled={!canEditSettings}
                        aria-label="Failed AutoPay recovery"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      For a verified Razorpay retry, members are told no action
                      is needed. A terminal failure asks for help only when its
                      exact current invoice remains collectible and no healthy
                      mandate covers it.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      New verified provider events only. A later captured
                      payment, refund hold, or restored mandate supersedes the
                      older recovery work before it can send.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Payment confirmations
                      <Badge
                        variant={
                          paymentConfirmationsEnabled ? 'success' : 'neutral'
                        }
                      >
                        {paymentConfirmationsEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={paymentConfirmationsEnabled}
                        onCheckedChange={setPaymentConfirmationsEnabled}
                        disabled={!canEditSettings}
                        aria-label="Payment confirmations"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Confirm new staff, checkout, payment-link, and captured
                      AutoPay payments from the committed ledger. A balance
                      settlement does not claim to renew a membership; a true
                      renewal includes its recorded end date.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Only payments committed after this is enabled are
                      eligible. Factual confirmations do not use the daily
                      collection-reminder cap.
                    </p>
                  </CardContent>
                </Card>
              </div>
            ) : null}
            {category === 'retention' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Session pack reminders
                      <Badge
                        variant={
                          sessionPackRemindersEnabled ? 'success' : 'neutral'
                        }
                      >
                        {sessionPackRemindersEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={sessionPackRemindersEnabled}
                        onCheckedChange={setSessionPackRemindersEnabled}
                        disabled={!canEditSettings}
                        aria-label="Session pack reminders"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Remind members at two sessions remaining and when their
                      current pack reaches zero. Attendance is counted from the
                      current pack cycle; this never blocks check-in.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Zero remaining supersedes the low-session reminder. New
                      cycles start fresh; there is no stored usage counter.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Planned freeze return
                      <Badge
                        variant={
                          freezeReturnRemindersEnabled ? 'success' : 'neutral'
                        }
                      >
                        {freezeReturnRemindersEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={freezeReturnRemindersEnabled}
                        onCheckedChange={setFreezeReturnRemindersEnabled}
                        disabled={!canEditSettings}
                        aria-label="Planned freeze return reminders"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Send one reminder the day before a staff-recorded planned
                      return, then create one staff follow-up on that date.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      This does not resume the membership, charge a payment, or
                      change membership dates.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Membership win-back
                      <Badge
                        variant={
                          membershipWinBackEnabled ? 'success' : 'neutral'
                        }
                      >
                        {membershipWinBackEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={membershipWinBackEnabled}
                        onCheckedChange={setMembershipWinBackEnabled}
                        disabled={!canEditSettings}
                        aria-label="Membership win-back"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Invite members back at 14, 30, and 60 days after an
                      unchanged expiry, after the short expiry sequence has
                      finished.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      A renewal, replacement cycle, cancellation, reply,
                      promise, or hold stops the campaign.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Service win-back
                      <Badge
                        variant={serviceWinBackEnabled ? 'success' : 'neutral'}
                      >
                        {serviceWinBackEnabled ? 'On' : 'Off'}
                      </Badge>
                    </CardTitle>
                    <CardAction>
                      <Switch
                        checked={serviceWinBackEnabled}
                        onCheckedChange={setServiceWinBackEnabled}
                        disabled={!canEditSettings}
                        aria-label="Service win-back"
                      />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Invite former service customers back at 14, 30, and 60
                      days after an unchanged expiry, using the current service
                      price.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      A renewed or replaced service, cancellation, reply,
                      promise, or hold stops the campaign.
                    </p>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="setup" className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Template approval is separate from whether a message is on.
              Create, submit, and sync templates in Settings → Templates.
            </p>
            {!whatsappConnected ? (
              <Alert>
                <AlertTitle>WhatsApp isn’t connected</AlertTitle>
                <AlertDescription>
                  <Link
                    data-slot="button"
                    href="/settings?tab=whatsapp"
                    className={buttonVariants({ variant: 'link', size: 'sm' })}
                  >
                    Open WhatsApp settings
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>WhatsApp template readiness</CardTitle>
                <CardAction>
                  <Link
                    data-slot="button"
                    href="/settings?tab=templates"
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                  >
                    Manage templates
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {featureStatuses.map(({ contract, status }) => (
                  <div
                    key={contract.id}
                    data-testid={`readiness-${contract.id}`}
                    className="border-border rounded-xl border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {contract.title}
                      </span>
                      <Badge variant={status.ready ? 'success' : 'warning'}>
                        {status.ready ? 'Ready' : 'Needs setup'}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {contract.category} template
                    </p>
                    {!status.ready ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        {status.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Scheduled reminder readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {diagnostics.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Readiness details are unavailable. Refresh this page to try
                    again.
                  </p>
                ) : (
                  diagnostics.map((diagnostic) => {
                    const badge = diagnosticBadge(diagnostic.state);
                    return (
                      <div
                        key={diagnostic.kind}
                        data-testid={`diagnostic-${diagnostic.kind}`}
                        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {DIAGNOSTIC_LABELS[diagnostic.kind]}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {diagnostic.reason}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {diagnosticDetail(diagnostic)}
                          </p>
                        </div>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>{' '}
            {reminderHistory.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Recent lifecycle reminder activity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {reminderHistory.map((entry, index) => (
                    <div
                      key={`${entry.state}-${entry.created_at}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-muted-foreground text-sm">
                        {entry.state === 'accepted'
                          ? 'Provider accepted a lifecycle reminder.'
                          : (entry.reason?.code ??
                            (entry.state === 'skipped'
                              ? 'Reminder paused or superseded.'
                              : 'Reminder is blocked.'))}
                        {entry.escalation_state
                          ? ` Staff follow-up: ${entry.escalation_state.replace('_', ' ')}.`
                          : ''}
                      </span>
                      <Badge
                        variant={
                          entry.state === 'accepted'
                            ? 'success'
                            : entry.state === 'skipped'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {entry.state === 'accepted'
                          ? 'Accepted'
                          : entry.state === 'skipped'
                            ? 'Paused'
                            : 'Blocked'}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {reminderHistory.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No recent lifecycle reminder activity.
              </p>
            ) : null}
          </TabsContent>
          {canEditSettings ? (
            <div className="flex justify-end pt-1">
              <Button
                onClick={handleSave}
                loading={saving}
                disabled={!hasChanges}
              >
                Save settings
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </Tabs>
  );
}
