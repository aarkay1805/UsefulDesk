import {
  createTemplateRepository,
  mobileTemplateQuerySource,
  templateFields,
  type TemplateQuerySource,
} from './template-repository';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import { BRANCH_ID, OTHER_BRANCH_ID } from './inbox-test-fixtures';

const TEMPLATE_ID = '5b52d03c-9d8c-4cf4-b8c6-a10b9b233571';

function rawTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    account_id: BRANCH_ID,
    name: 'appointment_reminder',
    language: 'en_US',
    category: 'Utility',
    body_text: 'Hello there.',
    header_type: null,
    header_content: null,
    header_media_url: null,
    buttons: [],
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    provider_missing_since: null,
    provider_components_sync_required_at: null,
    ...overrides,
  };
}

function source(): TemplateQuerySource {
  return {
    listTemplates: jest.fn().mockResolvedValue([]),
    findConnection: jest.fn().mockResolvedValue(null),
  };
}

function queryResult(data: unknown) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    order: jest.fn(),
    setHeader: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
    then: jest.fn((resolve) => resolve({ data, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.setHeader.mockReturnValue(query);
  return query;
}

describe('TemplateRepository', () => {
  it('returns only valid branch templates in stable name order', async () => {
    const querySource = source();
    querySource.listTemplates = jest.fn().mockResolvedValue([
      rawTemplate({
        id: '0552d03c-9d8c-4cf4-b8c6-a10b9b233571',
        name: 'zebra',
      }),
      rawTemplate({ name: 'alpha' }),
    ]);

    await expect(
      createTemplateRepository(querySource).listSendableTemplates(BRANCH_ID)
    ).resolves.toMatchObject([{ name: 'alpha' }, { name: 'zebra' }]);
    expect(querySource.listTemplates).toHaveBeenCalledWith(BRANCH_ID);
  });

  it('rejects malformed, cross-branch, and non-positional templates', async () => {
    const cases = [
      rawTemplate({ account_id: OTHER_BRANCH_ID }),
      rawTemplate({ parameter_format: 'NAMED' }),
      rawTemplate({ header_content: 'Hello {{1}}' }),
      rawTemplate({ header_media_url: 'https://x.test/a.jpg' }),
      rawTemplate({ buttons: [{ type: 'URL', text: 'Broken' }] }),
    ];

    for (const row of cases) {
      const querySource = source();
      querySource.listTemplates = jest.fn().mockResolvedValue([row]);
      await expect(
        createTemplateRepository(querySource).listSendableTemplates(BRANCH_ID)
      ).rejects.toThrow('Could not load sendable templates');
    }
  });

  it('reports that a media-header template is unavailable in this stage', async () => {
    const querySource = source();
    querySource.listTemplates = jest.fn().mockResolvedValue([
      rawTemplate({
        header_type: 'image',
        header_media_url: 'https://x.test/a.jpg',
      }),
    ]);

    await expect(
      createTemplateRepository(querySource).listSendableTemplates(BRANCH_ID)
    ).rejects.toThrow(
      'Templates with media headers are not supported on mobile.'
    );
  });

  it('describes absent, disconnected, and connected WhatsApp states for the selected branch', async () => {
    const querySource = source();
    const repository = createTemplateRepository(querySource);

    await expect(
      repository.getWhatsAppConnectionReadiness(BRANCH_ID)
    ).resolves.toEqual({
      status: 'absent',
      ready: false,
      reason: 'No WhatsApp connection is configured for this branch.',
      connectedAt: null,
    });

    querySource.findConnection = jest.fn().mockResolvedValue({
      account_id: BRANCH_ID,
      status: 'disconnected',
      connected_at: null,
    });
    await expect(
      repository.getWhatsAppConnectionReadiness(BRANCH_ID)
    ).resolves.toEqual({
      status: 'disconnected',
      ready: false,
      reason: 'WhatsApp is disconnected for this branch.',
      connectedAt: null,
    });

    querySource.findConnection = jest.fn().mockResolvedValue({
      account_id: BRANCH_ID,
      status: 'connected',
      connected_at: '2026-09-01T08:00:00.000Z',
    });
    await expect(
      repository.getWhatsAppConnectionReadiness(BRANCH_ID)
    ).resolves.toEqual({
      status: 'connected',
      ready: true,
      reason: null,
      connectedAt: '2026-09-01T08:00:00.000Z',
    });
  });

  it('returns no descriptors for a static positional template', () => {
    expect(
      templateFields({
        id: TEMPLATE_ID,
        name: 'static_notice',
        language: 'en_US',
        category: 'Utility',
        bodyText: 'Hello there.',
        headerType: null,
        headerContent: null,
        headerMediaUrl: null,
        buttons: [],
        status: 'APPROVED',
        parameterFormat: 'POSITIONAL',
        providerMissingSince: null,
        providerComponentsSyncRequiredAt: null,
      })
    ).toEqual([]);
  });

  it('orders body variables numerically before a text header and indexed button fields', () => {
    expect(
      templateFields({
        id: TEMPLATE_ID,
        name: 'order_update',
        language: 'en_US',
        category: 'Utility',
        bodyText: 'Hi {{2}}, your order {{1}} is ready.',
        headerType: 'text',
        headerContent: 'Hello {{1}}',
        headerMediaUrl: null,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Thanks' },
          { type: 'URL', text: 'Track order', url: 'https://x.test/{{1}}' },
          { type: 'COPY_CODE', text: 'Copy offer', example: 'WELCOME20' },
        ],
        status: 'APPROVED',
        parameterFormat: 'POSITIONAL',
        providerMissingSince: null,
        providerComponentsSyncRequiredAt: null,
      })
    ).toEqual([
      { kind: 'body', variable: 1, label: 'Body variable 1' },
      { kind: 'body', variable: 2, label: 'Body variable 2' },
      { kind: 'header', variable: 1, label: 'Header variable' },
      { kind: 'button', buttonIndex: 1, label: 'Track order' },
      {
        kind: 'button',
        buttonIndex: 2,
        label: 'Copy offer',
        defaultValue: 'WELCOME20',
      },
    ]);
  });

  it('scopes mobile template and connection reads to the selected branch', async () => {
    const from = jest.spyOn(mobileSupabase, 'from');
    selectedBranchRef.set(OTHER_BRANCH_ID);

    await expect(
      mobileTemplateQuerySource.listTemplates(BRANCH_ID)
    ).rejects.toThrow('Send readiness is unavailable');
    await expect(
      mobileTemplateQuerySource.findConnection(BRANCH_ID)
    ).rejects.toThrow('Send readiness is unavailable');

    expect(from).not.toHaveBeenCalled();
    from.mockRestore();
    selectedBranchRef.set(null);
  });

  it('uses approved and provider-synced account filters for branch readiness reads', async () => {
    const from = jest.spyOn(mobileSupabase, 'from');
    const templates = queryResult([]);
    const connection = queryResult(null);
    from
      .mockReturnValueOnce(templates as never)
      .mockReturnValueOnce(connection as never);
    selectedBranchRef.set(BRANCH_ID);

    await mobileTemplateQuerySource.listTemplates(BRANCH_ID);
    await mobileTemplateQuerySource.findConnection(BRANCH_ID);

    expect(templates.eq).toHaveBeenCalledWith('account_id', BRANCH_ID);
    expect(templates.eq).toHaveBeenCalledWith('status', 'APPROVED');
    expect(templates.is).toHaveBeenCalledWith('provider_missing_since', null);
    expect(templates.is).toHaveBeenCalledWith(
      'provider_components_sync_required_at',
      null
    );
    expect(templates.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(templates.setHeader).toHaveBeenCalledWith(
      'x-usefuldesk-account-id',
      BRANCH_ID
    );
    expect(connection.eq).toHaveBeenCalledWith('account_id', BRANCH_ID);
    expect(connection.setHeader).toHaveBeenCalledWith(
      'x-usefuldesk-account-id',
      BRANCH_ID
    );

    from.mockRestore();
    selectedBranchRef.set(null);
  });
});
