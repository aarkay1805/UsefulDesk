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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { getErrorMessage } from '@/lib/errors';
import {
  DEFAULT_DAYS_BEFORE,
  normalizeDaysBefore,
} from '@/lib/memberships/renewal-reminders';
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
import { SettingsPanelHead } from './settings-panel-head';

const PANEL_DESCRIPTION =
  'Choose when UsefulDesk sends WhatsApp reminders for expiring memberships and services.';

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
}

interface SetupStatus {
  ready: boolean;
  badge: string;
  title: string;
  description: string;
  href: string;
  action: string;
}

function configKey(config: ReminderConfig) {
  return JSON.stringify({
    enabled: config.enabled,
    offsets: normalizeDaysBefore(config.offsets),
    serviceEnabled: config.serviceEnabled,
    serviceOffsets: normalizeDaysBefore(config.serviceOffsets),
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

function SetupNote({ status }: { status: SetupStatus }) {
  if (status.ready) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      role="status"
    >
      <span className="text-muted-foreground">
        <span className="text-foreground font-medium">{status.title}.</span>{' '}
        {status.description}
      </span>
      <Link
        data-slot="button"
        href={status.href}
        className={buttonVariants({ variant: 'link', size: 'xs' })}
      >
        {status.action}
      </Link>
    </div>
  );
}

/** Account-level schedule for membership and renewable-service reminders. */
export function RenewalRemindersSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [enabled, setEnabled] = useState(false);
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_DAYS_BEFORE);
  const [serviceEnabled, setServiceEnabled] = useState(false);
  const [serviceOffsets, setServiceOffsets] =
    useState<number[]>(DEFAULT_DAYS_BEFORE);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [templates, setTemplates] = useState<TemplateReadinessRow[]>([]);
  const [savedConfigKey, setSavedConfigKey] = useState('');

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);

      const [settingsResult, templatesResult, whatsappResult] =
        await Promise.all([
          supabase
            .from('renewal_reminder_settings')
            .select(
              'enabled, days_before, service_enabled, service_days_before'
            )
            .eq('account_id', accountId)
            .maybeSingle(),
          supabase
            .from('message_templates')
            .select('*')
            .eq('account_id', accountId)
            .in(
              'name',
              FEATURE_TEMPLATE_CONTRACTS.map(
                (contract) => contract.payload.name
              )
            ),
          supabase
            .from('whatsapp_config')
            .select('status')
            .eq('account_id', accountId)
            .maybeSingle(),
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
      };
      const templates = templatesResult.data ?? [];

      setEnabled(nextConfig.enabled);
      setOffsets(nextConfig.offsets);
      setServiceEnabled(nextConfig.serviceEnabled);
      setServiceOffsets(nextConfig.serviceOffsets);
      setWhatsappConnected(whatsappResult.data?.status === 'connected');
      setTemplates(templates);
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
  const membershipStatus = resolveContractSetupStatus(
    whatsappConnected,
    templates,
    'membership_renewal'
  );
  const serviceStatus = resolveContractSetupStatus(
    whatsappConnected,
    templates,
    'service_renewal'
  );

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
          title="Renewal reminders"
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
          title="Renewal reminders"
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
    <section className="animate-in fade-in-50 max-w-5xl duration-200">
      <SettingsPanelHead
        title="Renewal reminders"
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

        <Card>
          <CardHeader>
            <CardTitle>WhatsApp template readiness</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {featureStatuses.map(({ contract, status }) => (
              <div
                key={contract.id}
                data-testid={`readiness-${contract.id}`}
                className="border-border rounded-xl border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{contract.title}</span>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Membership reminders
              <Badge variant={membershipStatus.ready ? 'success' : 'warning'}>
                {membershipStatus.badge}
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
            <SetupNote status={membershipStatus} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Service reminders
              <Badge variant={serviceStatus.ready ? 'success' : 'warning'}>
                {serviceStatus.badge}
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
              Message members before a renewable service expires. Services
              without a current trainer fee are skipped.
            </p>
            <Collapse open={serviceEnabled}>
              <ReminderSchedule
                labelId="service-reminder-schedule"
                offsets={serviceOffsets}
                onChange={setServiceOffsets}
                disabled={!canEditSettings}
              />
            </Collapse>
            <SetupNote status={serviceStatus} />
          </CardContent>
        </Card>

        {canEditSettings ? (
          <div className="flex justify-end pt-1">
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save settings'
              )}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
