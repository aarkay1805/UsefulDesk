import {
  canSendMessages,
  type AccountRole,
} from '../../../../../src/lib/auth/roles';

import type { ConnectionReadiness } from './inbox-types';

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TemplateReadiness {
  hasLocalTemplates: boolean;
  contractReady: boolean;
}

export interface ConversationActionInput {
  role: AccountRole;
  now: Date | string;
  latestInboundAt: string | null;
  templateReadiness: TemplateReadiness;
  connectionReadiness: ConnectionReadiness;
}

export type ActionBlocker =
  | {
      kind: 'local_templates';
      title: 'No sendable templates';
      reason: 'Add an approved WhatsApp template before sending outside the customer-service window.';
    }
  | {
      kind: 'template_contract';
      title: 'Template setup needs attention';
      reason: 'Sync an approved WhatsApp template contract before sending outside the customer-service window.';
    }
  | {
      kind: 'provider';
      title: 'WhatsApp is unavailable';
      reason: string;
    };

export type ConversationActionState =
  | { kind: 'viewer' }
  | { kind: 'open_text' }
  | { kind: 'closed_template' }
  | { kind: 'blocked'; blocker: ActionBlocker };

function instant(value: Date | string): number | null {
  const valueMs = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(valueMs) ? valueMs : null;
}

function isServiceWindowOpen(
  now: Date | string,
  latestInboundAt: string | null
): boolean {
  if (latestInboundAt === null) return false;
  const nowMs = instant(now);
  const latestInboundMs = instant(latestInboundAt);
  if (nowMs === null || latestInboundMs === null) return false;
  return (
    nowMs >= latestInboundMs && nowMs - latestInboundMs < SERVICE_WINDOW_MS
  );
}

function providerBlocker(readiness: ConnectionReadiness): ActionBlocker {
  return {
    kind: 'provider',
    title: 'WhatsApp is unavailable',
    reason:
      readiness.reason ??
      'Connect WhatsApp for this branch before sending customer messages.',
  };
}

export function resolveConversationActions(
  input: ConversationActionInput
): ConversationActionState {
  if (!canSendMessages(input.role)) return { kind: 'viewer' };

  const serviceWindowOpen = isServiceWindowOpen(
    input.now,
    input.latestInboundAt
  );
  if (serviceWindowOpen && !input.connectionReadiness.ready) {
    return {
      kind: 'blocked',
      blocker: providerBlocker(input.connectionReadiness),
    };
  }

  if (serviceWindowOpen) {
    return { kind: 'open_text' };
  }

  if (!input.templateReadiness.hasLocalTemplates) {
    return {
      kind: 'blocked',
      blocker: {
        kind: 'local_templates',
        title: 'No sendable templates',
        reason:
          'Add an approved WhatsApp template before sending outside the customer-service window.',
      },
    };
  }

  if (!input.templateReadiness.contractReady) {
    return {
      kind: 'blocked',
      blocker: {
        kind: 'template_contract',
        title: 'Template setup needs attention',
        reason:
          'Sync an approved WhatsApp template contract before sending outside the customer-service window.',
      },
    };
  }

  if (!input.connectionReadiness.ready) {
    return {
      kind: 'blocked',
      blocker: providerBlocker(input.connectionReadiness),
    };
  }

  return { kind: 'closed_template' };
}
