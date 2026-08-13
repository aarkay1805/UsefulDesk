'use client';

// ============================================================
// Settings → Lead capture.
//
// "Where do my leads come from" — one section for every inbound
// channel. The public enquiry form ships today; the Meta lead-ads card
// renders only once NEXT_PUBLIC_META_LEADS_CONFIG_ID is set, which is
// the dark-launch gate while Meta App Review is pending.
// ============================================================

import { LeadCaptureSettings } from '@/components/settings/lead-capture-settings';
import { MetaLeadsConnect } from '@/components/settings/meta-leads-connect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/use-auth';

import { SettingsPanelHead } from './settings-panel-head';

export function LeadCapturePanel() {
  const { canEditSettings, profileLoading } = useAuth();

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead
        title="Lead capture"
        description="Manage the ways new enquiries enter UsefulDesk."
      />

      <div className="space-y-4">
        {!profileLoading && !canEditSettings ? (
          <Alert>
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>
              Only admins and owners can change lead capture settings.
            </AlertDescription>
          </Alert>
        ) : null}
        <LeadCaptureSettings />
        <MetaLeadsConnect />
      </div>
    </section>
  );
}
