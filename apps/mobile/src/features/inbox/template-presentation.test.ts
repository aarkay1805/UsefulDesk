import type { NativeTemplate } from './inbox-types';
import {
  matchesTemplateQuery,
  prefillTemplateValues,
  presentTemplate,
  previewSegments,
  previewText,
} from './template-presentation';

jest.mock('../../data/supabase', () => ({
  mobileSupabase: {},
  selectedBranchRef: { get: () => null },
}));

const fmt = {
  date: (value: unknown) => `date(${String(value)})`,
  money: (value: number) => `₹${value}`,
};

function template(overrides: Partial<NativeTemplate> = {}): NativeTemplate {
  return {
    id: 'template-1',
    name: 'gym_membership_renewal',
    language: 'en_US',
    category: 'Marketing',
    bodyText:
      'Hi {{1}}, your {{2}} membership ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.',
    footerText: null,
    headerType: null,
    headerContent: null,
    headerMediaUrl: null,
    buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
    status: 'APPROVED',
    parameterFormat: 'POSITIONAL',
    providerMissingSince: null,
    providerComponentsSyncRequiredAt: null,
    ...overrides,
  };
}

const context = {
  contactName: '  Rahul Sharma ',
  legalName: 'Iron House Fitness Private Limited',
  membership: {
    planName: 'Gold 3 months',
    endDate: '2026-09-30',
    feeAmount: 4500,
  },
};

describe('presentTemplate', () => {
  it('names a wired template and its blanks the way the website does', () => {
    const presentation = presentTemplate(template());

    expect(presentation.title).toBe('Membership renewal');
    expect(presentation.inputs.map((input) => input.label)).toEqual([
      'Member name',
      'Plan name',
      'Membership end date',
      'Current renewal price',
      'Legal business name',
    ]);
    expect(presentation.usesMembership).toBe(true);
    expect(
      presentation.inputs.filter((input) => input.automatic).map((i) => i.key)
    ).toEqual(['body:5']);
  });

  it('keeps plain labels for an older approved copy with a different shape', () => {
    const presentation = presentTemplate(
      template({
        bodyText: 'Hi {{1}}, your {{2}} membership ends on {{3}}. Fee {{4}}.',
      })
    );

    expect(presentation.title).toBe('Membership renewal');
    expect(presentation.inputs.map((input) => input.label)).toEqual([
      'Message detail 1',
      'Message detail 2',
      'Message detail 3',
      'Message detail 4',
    ]);
    expect(presentation.usesMembership).toBe(false);
    expect(presentation.inputs.some((input) => input.automatic)).toBe(false);
  });

  it('turns a custom template name into a readable title', () => {
    const presentation = presentTemplate(
      template({ name: 'gym_diwali_offer_2026', bodyText: 'Hello {{1}}' })
    );

    expect(presentation.title).toBe('Diwali offer 2026');
    expect(presentation.inputs[0].label).toBe('Message detail 1');
  });

  it('asks for the legal name of an unwired template instead of assuming the server adds it', () => {
    const presentation = presentTemplate(
      template({
        name: 'gym_festival_offer',
        bodyText:
          'Hi {{1}}, celebrate {{2}} at {{3}} with {{4}} off until {{5}}.',
      })
    );

    expect(presentation.inputs[2]).toMatchObject({
      label: 'Legal business name',
      automatic: false,
      source: 'legal_name',
    });
  });

  it('labels header and button blanks by what they change', () => {
    const presentation = presentTemplate(
      template({
        name: 'custom',
        bodyText: 'Hi {{1}}',
        headerType: 'text',
        headerContent: 'For {{1}}',
        buttons: [
          { type: 'URL', text: 'Pay now', url: 'https://pay.test/{{1}}' },
          { type: 'COPY_CODE', text: 'Copy code', example: 'GYM20' },
        ],
      })
    );

    expect(presentation.inputs.map((input) => input.label)).toEqual([
      'Message detail 1',
      'Title text',
      'Link for the “Pay now” button',
      'Code for the “Copy code” button',
    ]);
  });
});

describe('prefillTemplateValues', () => {
  it('fills the member, membership, and legal name before anyone types', () => {
    const presentation = presentTemplate(template());

    expect(prefillTemplateValues(presentation, context, fmt)).toEqual({
      'body:1': 'Rahul Sharma',
      'body:2': 'Gold 3 months',
      'body:3': 'date(2026-09-30)',
      'body:4': '₹4500',
      'body:5': 'Iron House Fitness Private Limited',
    });
  });

  it('leaves unknown values empty rather than guessing', () => {
    const presentation = presentTemplate(template());

    expect(
      prefillTemplateValues(
        presentation,
        { contactName: null, legalName: null, membership: null },
        fmt
      )
    ).toEqual({});
  });

  it('never reads membership details into a template about something else', () => {
    const presentation = presentTemplate(
      template({
        name: 'gym_session_pack_low',
        bodyText:
          'Hi {{1}}, your {{2}} has {{3}} sessions left. Reply to {{4}} to ask about your next pack.',
      })
    );

    expect(prefillTemplateValues(presentation, context, fmt)).toEqual({
      'body:1': 'Rahul Sharma',
      'body:4': 'Iron House Fitness Private Limited',
    });
  });

  it('starts a copy-code button from its approved example', () => {
    const presentation = presentTemplate(
      template({
        name: 'custom',
        bodyText: 'Use the code below.',
        buttons: [{ type: 'COPY_CODE', text: 'Copy', example: 'GYM20' }],
      })
    );

    expect(prefillTemplateValues(presentation, context, fmt)).toEqual({
      'button:0': 'GYM20',
    });
  });
});

describe('preview', () => {
  it('shows filled values in place and names each missing blank', () => {
    const presentation = presentTemplate(template());
    const values = { 'body:1': 'Rahul', 'body:3': '30 Sep' };

    expect(
      previewText(presentation.template.bodyText, 'body', presentation, values)
    ).toBe(
      'Hi Rahul, your [Plan name] membership ends on 30 Sep. Current renewal price: [Current renewal price]. Reply to [Legal business name] for help renewing.'
    );
    expect(
      previewSegments('Hi {{1}}, {{2}}', 'body', presentation, values)
    ).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'value', text: 'Rahul' },
      { kind: 'text', text: ', ' },
      { kind: 'missing', text: '[Plan name]' },
    ]);
  });
});

describe('matchesTemplateQuery', () => {
  it('matches every typed word against the title and message', () => {
    const presentation = presentTemplate(template());

    expect(matchesTemplateQuery(presentation, '')).toBe(true);
    expect(matchesTemplateQuery(presentation, 'RENEWAL')).toBe(true);
    expect(matchesTemplateQuery(presentation, 'renewal price')).toBe(true);
    expect(matchesTemplateQuery(presentation, 'renewal invoice')).toBe(false);
  });
});
