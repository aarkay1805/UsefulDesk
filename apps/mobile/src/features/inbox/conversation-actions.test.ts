import {
  resolveConversationActions,
  SERVICE_WINDOW_MS,
  type ConversationActionInput,
} from './conversation-actions';

const NOW = '2026-09-01T12:00:00.000Z';

function input(
  overrides: Partial<ConversationActionInput> = {}
): ConversationActionInput {
  return {
    role: 'agent',
    now: NOW,
    latestInboundAt: new Date(
      Date.parse(NOW) - SERVICE_WINDOW_MS + 1
    ).toISOString(),
    templateReadiness: {
      hasLocalTemplates: true,
      contractReady: true,
    },
    connectionReadiness: {
      status: 'connected',
      ready: true,
      reason: null,
      connectedAt: NOW,
    },
    ...overrides,
  };
}

describe('resolveConversationActions', () => {
  it('omits all customer-send controls for viewers', () => {
    expect(
      resolveConversationActions(
        input({
          role: 'viewer',
          latestInboundAt: null,
          templateReadiness: {
            hasLocalTemplates: false,
            contractReady: false,
          },
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
        })
      )
    ).toEqual({ kind: 'viewer' });
  });

  it('uses the template-only branch when no customer message has opened a service window', () => {
    expect(
      resolveConversationActions(input({ latestInboundAt: null }))
    ).toEqual({ kind: 'closed_template' });
  });

  it('keeps text open immediately inside the exact 24-hour instant boundary', () => {
    expect(resolveConversationActions(input())).toEqual({ kind: 'open_text' });
  });

  it('closes text at the exact 24-hour instant boundary', () => {
    expect(
      resolveConversationActions(
        input({
          latestInboundAt: new Date(
            Date.parse(NOW) - SERVICE_WINDOW_MS
          ).toISOString(),
        })
      )
    ).toEqual({ kind: 'closed_template' });
  });

  it('fails closed when the latest inbound timestamp is in the future', () => {
    expect(
      resolveConversationActions(
        input({
          latestInboundAt: new Date(Date.parse(NOW) + 1).toISOString(),
        })
      )
    ).toEqual({ kind: 'closed_template' });
  });

  it('keeps text open without any template availability', () => {
    expect(
      resolveConversationActions(
        input({
          templateReadiness: {
            hasLocalTemplates: false,
            contractReady: false,
          },
        })
      )
    ).toEqual({ kind: 'open_text' });
  });

  it('resolves exactly one blocker by permission, local data, contract, then provider priority', () => {
    expect(
      resolveConversationActions(
        input({
          role: 'viewer',
          latestInboundAt: null,
          templateReadiness: {
            hasLocalTemplates: false,
            contractReady: false,
          },
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
        })
      )
    ).toEqual({ kind: 'viewer' });

    expect(
      resolveConversationActions(
        input({
          latestInboundAt: null,
          templateReadiness: {
            hasLocalTemplates: false,
            contractReady: false,
          },
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
        })
      )
    ).toMatchObject({ kind: 'blocked', blocker: { kind: 'local_templates' } });

    expect(
      resolveConversationActions(
        input({
          latestInboundAt: null,
          templateReadiness: {
            hasLocalTemplates: true,
            contractReady: false,
          },
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
        })
      )
    ).toMatchObject({
      kind: 'blocked',
      blocker: { kind: 'template_contract' },
    });

    expect(
      resolveConversationActions(
        input({
          latestInboundAt: null,
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
        })
      )
    ).toMatchObject({ kind: 'blocked', blocker: { kind: 'provider' } });
  });

  it('blocks open text only when the provider connection is unavailable', () => {
    expect(
      resolveConversationActions(
        input({
          connectionReadiness: {
            status: 'absent',
            ready: false,
            reason: 'No WhatsApp connection is configured for this branch.',
            connectedAt: null,
          },
        })
      )
    ).toMatchObject({ kind: 'blocked', blocker: { kind: 'provider' } });
  });
});
