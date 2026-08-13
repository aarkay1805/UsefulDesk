'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { LeadCapturePanel } from '@/components/settings/lead-capture-panel';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { PlansSettings } from '@/components/settings/plans-settings';
import { ProductsServicesSettings } from '@/components/settings/products-services-settings';
import { RenewalRemindersSettings } from '@/components/settings/renewal-reminders-settings';
import { DealsSettings } from '@/components/settings/deals-settings';
import { LocalizationSettings } from '@/components/settings/localization-settings';
import { OrganizationSettings } from '@/components/settings/organization-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useAuth();
  const { mode } = useTheme();

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      localization: locale.countryCode,
    }),
    [mode, locale.countryCode]
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    capture: <LeadCapturePanel />,
    templates: <TemplateManager />,
    fields: <FieldsAndTagsPanel />,
    plans: <PlansSettings />,
    'products-services': <ProductsServicesSettings />,
    reminders: <RenewalRemindersSettings />,
    deals: <DealsSettings />,
    localization: <LocalizationSettings />,
    organization: <OrganizationSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
      <SettingsRail active={section} onSelect={go} hints={hints} />
      <div className="min-w-0">{panel[section]}</div>
    </div>
  );
}
