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

export function LeadCapturePanel() {
  return (
    <div className="space-y-6">
      <LeadCaptureSettings />
      <MetaLeadsConnect />
    </div>
  );
}
