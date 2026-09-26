import {
  canSendMessages,
  type AccountRole,
} from '../../../../../src/lib/auth/roles';

import type { BranchAccount } from '../auth/branch-types';
import type { ConnectionReadiness } from './inbox-types';

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TemplateReadiness =
  | {
      status: 'ready';
      hasLocalTemplates: boolean;
      contractReady: boolean;
    }
  | {
      status: 'error';
      hasLocalTemplates: false;
      contractReady: false;
    };

export interface ConversationActionInput {
  role: AccountRole;
  branchStatus: BranchAccount['branch_status'];
  now: Date | string;
  latestInboundAt: string | null;
  templateReadiness: TemplateReadiness | null;
  connectionReadiness: ConnectionReadiness;
}

export type ActionBlocker =
  | {
      kind: 'local_templates';
      title: 'No approved templates yet';
      reason: 'After 24 hours, you can send only an approved template. Add one on the UsefulDesk website.';
    }
  | {
      kind: 'template_contract';
      title: 'Templates need an update';
      reason: 'Refresh your approved templates on the UsefulDesk website, then try again.';
    }
  | {
      kind: 'template_readiness';
      title: 'Could not load templates';
      reason: 'Pull down to refresh and try again.';
    }
  | {
      kind: 'provider';
      title: 'WhatsApp is not ready';
      reason: string;
    };

export type ConversationActionState =
  | { kind: 'viewer' }
  | { kind: 'inactive_branch' }
  | { kind: 'loading' }
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
    title: 'WhatsApp is not ready',
    reason:
      readiness.reason ??
      'Connect WhatsApp for this branch before you send messages.',
  };
}

export function canUseConversationOutbound(
  role: AccountRole,
  branchStatus: BranchAccount['branch_status']
): boolean {
  return branchStatus === 'active' && canSendMessages(role);
}

export function resolveConversationActions(
  input: ConversationActionInput
): ConversationActionState {
  if (!canSendMessages(input.role)) return { kind: 'viewer' };
  if (!canUseConversationOutbound(input.role, input.branchStatus)) {
    return { kind: 'inactive_branch' };
  }

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

  if (input.templateReadiness === null) return { kind: 'loading' };

  if (input.templateReadiness.status === 'error') {
    return {
      kind: 'blocked',
      blocker: {
        kind: 'template_readiness',
        title: 'Could not load templates',
        reason: 'Pull down to refresh and try again.',
      },
    };
  }

  if (!input.templateReadiness.hasLocalTemplates) {
    return {
      kind: 'blocked',
      blocker: {
        kind: 'local_templates',
        title: 'No approved templates yet',
        reason:
          'After 24 hours, you can send only an approved template. Add one on the UsefulDesk website.',
      },
    };
  }

  if (!input.templateReadiness.contractReady) {
    return {
      kind: 'blocked',
      blocker: {
        kind: 'template_contract',
        title: 'Templates need an update',
        reason:
          'Refresh your approved templates on the UsefulDesk website, then try again.',
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
