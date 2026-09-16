'use client';

import { Suspense } from 'react';
import { notFound } from 'next/navigation';

import { RenewalRemindersSettings } from '@/components/settings/renewal-reminders-settings';
import {
  REMINDER_RULES,
  ruleSettingsFromRow,
  type ReminderRuleResponse,
} from '@/lib/reminders/rules';

// Dev-only visual harness for Settings → Automated messages. The real panel
// lives behind auth and reads branch settings plus template readiness, so this
// answers its settings request with every rule at its defaults and a mix of
// readiness states (ready, template missing, WhatsApp missing). Outside the
// auth provider every `canX` is false, so the panel renders read-only — the
// expanded hierarchy is the same either way. Open a group with `?rule=<id>`.
// Never reachable in production.

const RULES: ReminderRuleResponse[] = REMINDER_RULES.map((rule, index) => ({
  ...rule,
  settings: {
    ...ruleSettingsFromRow(rule, null),
    ...(index % 3 === 0 ? { enabled: true } : {}),
  },
  readiness:
    index % 4 === 1
      ? {
          ready: false,
          code: 'template_missing',
          message: 'Create and approve the exact template before it can send.',
          templateContractId: rule.templateContracts[0],
        }
      : { ready: true, code: 'ready' },
}));

if (typeof window !== 'undefined') {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/reminders/settings')) {
      return new Response(
        JSON.stringify({ whatsappConnected: true, rules: RULES }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input, init);
  };
}

export default function AutomatedMessagesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-screen p-4 sm:p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <div aria-hidden className="hidden lg:block" />
        <div className="min-w-0">
          <Suspense>
            <RenewalRemindersSettings />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
