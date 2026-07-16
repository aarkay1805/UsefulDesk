'use client';

import { GetStartedView } from '@/components/onboarding/get-started-view';

// Get Started — the onboarding checklist for freshly created gyms.
// All state lives in OnboardingProvider (mounted in the dashboard
// shell) so the sidebar badge and this page share one fetch.
export default function GetStartedPage() {
  return <GetStartedView />;
}
