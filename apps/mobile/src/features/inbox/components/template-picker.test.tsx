import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { ActionBlocker } from '../conversation-actions';
import type { NativeTemplate } from '../inbox-types';
import {
  MobileSendError,
  sendConversationMessage,
} from '../send-message-client';
import { keyboardAvoidingBehavior, TemplatePicker } from './template-picker';

const ACCOUNT_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';
const mockRecoverUnauthorizedSession = jest.fn().mockResolvedValue(undefined);

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text, TextInput, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockButton({
    children,
    isDisabled,
    ...props
  }: import('react-native').PressableProps & {
    children?: import('react').ReactNode;
    isDisabled?: boolean;
  }) {
    return React.createElement(
      Pressable,
      {
        ...props,
        accessibilityRole: 'button',
        disabled: isDisabled,
      },
      children
    );
  }
  MockButton.Label = function MockButtonLabel({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  let currentFieldLabel = '';
  const MockTextField = ({ children }: import('react').PropsWithChildren) =>
    React.createElement(View, null, children);
  const MockLabel = ({ children }: import('react').PropsWithChildren) => {
    currentFieldLabel = String(children);
    return React.createElement(Text, null, children);
  };
  const MockInput = ({ isDisabled, ...props }: any) =>
    React.createElement(TextInput, {
      ...props,
      accessibilityLabel: currentFieldLabel,
      editable: !isDisabled,
    });
  const MockFieldError = ({ children }: import('react').PropsWithChildren) =>
    React.createElement(Text, { accessibilityRole: 'alert' }, children);

  return {
    Button: MockButton,
    FieldError: MockFieldError,
    Input: MockInput,
    Label: MockLabel,
    TextField: MockTextField,
  };
});

jest.mock('../../auth/auth-context', () => ({
  useReadyAuth: () => ({
    recoverUnauthorizedSession: mockRecoverUnauthorizedSession,
  }),
}));

jest.mock('../send-message-client', () => ({
  ...jest.requireActual('../send-message-client'),
  sendConversationMessage: jest.fn(),
}));

const send = jest.mocked(sendConversationMessage);

const membershipTemplate: NativeTemplate = {
  id: 'template-1',
  name: 'gym_membership_renewal',
  language: 'en',
  category: 'Marketing',
  bodyText: 'Hi {{1}}, your membership expires {{2}}.',
  headerType: 'text',
  headerContent: '{{1}}',
  headerMediaUrl: null,
  buttons: [
    { type: 'URL', text: 'Renew now', url: 'https://pay.example.test/{{1}}' },
    { type: 'QUICK_REPLY', text: 'Talk to us' },
  ],
  status: 'APPROVED',
  parameterFormat: 'POSITIONAL',
  providerMissingSince: null,
  providerComponentsSyncRequiredAt: null,
};

const copyCodeTemplate: NativeTemplate = {
  ...membershipTemplate,
  id: 'template-2',
  name: 'gym_offer',
  bodyText: 'Use code {{1}} this week.',
  headerType: null,
  headerContent: null,
  buttons: [
    { type: 'QUICK_REPLY', text: 'Talk to us' },
    { type: 'COPY_CODE', text: 'Copy offer', example: 'WELCOME20' },
  ],
};

const staticTemplate: NativeTemplate = {
  ...membershipTemplate,
  id: 'template-3',
  name: 'static_notice',
  bodyText: 'The gym opens at 6 AM.',
  headerType: null,
  headerContent: null,
  buttons: [],
};

function renderPicker(options?: {
  templates?: NativeTemplate[];
  blocker?: ActionBlocker | null;
  outcomeUnknown?: boolean;
  onClose?: jest.Mock;
  onOutcomeAcknowledged?: jest.Mock;
  onOutcomeUnknown?: jest.Mock;
  onSent?: jest.Mock;
}) {
  const onClose = options?.onClose ?? jest.fn();
  const onOutcomeAcknowledged = options?.onOutcomeAcknowledged ?? jest.fn();
  const onOutcomeUnknown = options?.onOutcomeUnknown ?? jest.fn();
  const onSent = options?.onSent ?? jest.fn();
  render(
    <TemplatePicker
      accountId={ACCOUNT_ID}
      blocker={options?.blocker ?? null}
      conversationId={CONVERSATION_ID}
      onClose={onClose}
      onOutcomeAcknowledged={onOutcomeAcknowledged}
      onOutcomeUnknown={onOutcomeUnknown}
      onSent={onSent}
      outcomeUnknown={options?.outcomeUnknown ?? false}
      templates={options?.templates ?? [membershipTemplate, copyCodeTemplate]}
    />
  );
  return {
    onClose,
    onOutcomeAcknowledged,
    onOutcomeUnknown,
    onSent,
  };
}

function fillMembershipFields() {
  fireEvent.changeText(screen.getByLabelText('Body variable 1'), '  Rajat  ');
  fireEvent.changeText(screen.getByLabelText('Body variable 2'), '  30 Sep ');
  fireEvent.changeText(
    screen.getByLabelText('Header variable'),
    '  September renewal '
  );
  fireEvent.changeText(screen.getByLabelText('Renew now'), '  member-42 ');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('TemplatePicker', () => {
  beforeEach(() => {
    send.mockReset();
    mockRecoverUnauthorizedSession.mockClear();
  });

  it('shows one actionable blocker and no send controls when readiness is blocked', () => {
    const blocker: ActionBlocker = {
      kind: 'template_contract',
      title: 'Template setup needs attention',
      reason:
        'Sync an approved WhatsApp template contract before sending outside the customer-service window.',
    };

    renderPicker({ blocker });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText(blocker.title)).toBeTruthy();
    expect(screen.getByText(blocker.reason)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'gym_membership_renewal, Approved' })
    ).toBeNull();
  });

  it.each([
    ['a non-contiguous body variable', { bodyText: 'Hi {{2}}.' }],
    [
      'a malformed dynamic URL placeholder',
      {
        buttons: [
          { type: 'URL', text: 'Renew now', url: 'https://pay.test/{{2}}' },
        ],
      },
    ],
    [
      'an empty COPY_CODE default',
      {
        buttons: [{ type: 'COPY_CODE', text: 'Copy offer', example: '   ' }],
      },
    ],
    [
      'a text header missing its content',
      { headerType: 'text', headerContent: null },
    ],
    ['a non-array button payload', { buttons: null }],
  ])('fails closed for %s', (_name, overrides) => {
    renderPicker({
      templates: [{ ...membershipTemplate, ...overrides } as NativeTemplate],
    });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Template setup needs attention')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses native keyboard avoidance for both supported platforms', () => {
    expect(keyboardAvoidingBehavior('ios')).toBe('padding');
    expect(keyboardAvoidingBehavior('android')).toBe('height');
  });

  it('uses semantic foreground roles for the sheet title and section hierarchy', () => {
    renderPicker();

    expect(
      screen.getByText('Send approved template').props.className
    ).toContain('text-foreground');
    expect(screen.getByText('Approved templates').props.className).toContain(
      'text-foreground'
    );
    expect(screen.getByText('Template values').props.className).toContain(
      'text-foreground'
    );
  });

  it('keeps the preview and approval copy contrast-safe on a semantic surface', () => {
    renderPicker();

    expect(screen.getByTestId('template-preview').props.className).toContain(
      'bg-surface-secondary'
    );
    expect(screen.getByText('Preview').props.className).toContain(
      'text-surface-secondary-foreground'
    );
    expect(
      screen.getByText('Hi {{1}}, your membership expires {{2}}.').props
        .className
    ).toContain('text-surface-secondary-foreground');
    expect(screen.getByText('Approved').props.className).toContain(
      'text-surface-secondary-foreground'
    );
  });

  it('exposes and visibly names the selected template', () => {
    renderPicker();

    const selected = screen.getByRole('button', {
      name: 'gym_membership_renewal, Approved, Selected',
    });
    const unselected = screen.getByRole('button', {
      name: 'gym_offer, Approved',
    });

    expect(selected.props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
    expect(unselected.props.accessibilityState).toEqual({
      disabled: false,
      selected: false,
    });
    expect(screen.getByText('gym_membership_renewal · Selected')).toBeTruthy();
    expect(screen.getByTestId('template-option-template-1').props.variant).toBe(
      'primary'
    );
    expect(screen.getByTestId('template-option-template-2').props.variant).toBe(
      'outline'
    );
  });

  it('lists approved templates, previews static content, and preserves template field order', () => {
    renderPicker();

    expect(
      screen.getByRole('button', {
        name: 'gym_membership_renewal, Approved, Selected',
      })
    ).toBeTruthy();
    expect(
      screen.getByText('Hi {{1}}, your membership expires {{2}}.')
    ).toBeTruthy();
    expect(
      screen
        .getAllByLabelText(/Body variable|Header variable|Renew now/)
        .map((field) => field.props.accessibilityLabel)
    ).toEqual([
      'Body variable 1',
      'Body variable 2',
      'Header variable',
      'Renew now',
    ]);
    expect(screen.getByLabelText('Body variable 1').props.className).toContain(
      'min-h-11'
    );
  });

  it('validates every positional field and initializes COPY_CODE from its approved default', () => {
    renderPicker();

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));
    expect(screen.getByText('Enter a value for Body variable 1.')).toBeTruthy();
    expect(screen.getByText('Enter a value for Header variable.')).toBeTruthy();
    expect(screen.getByText('Enter a value for Renew now.')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();

    fireEvent(
      screen.getByRole('button', { name: 'gym_offer, Approved' }),
      'accessibilityTap'
    );
    expect(screen.getByLabelText('Copy offer').props.value).toBe('WELCOME20');
    fireEvent.changeText(
      screen.getByLabelText('Body variable 1'),
      '  OFFER25 '
    );
    fireEvent.changeText(screen.getByLabelText('Copy offer'), '  CUSTOM25 ');
    expect(screen.getByText('Use code OFFER25 this week.')).toBeTruthy();
  });

  it('sends exact trimmed positional body, header, and original button-index values', async () => {
    send.mockResolvedValue({
      messageId: 'message-1',
      whatsappMessageId: 'wamid.1',
    });
    const { onClose, onSent } = renderPicker({
      templates: [membershipTemplate],
    });

    fillMembershipFields();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'template',
          accountId: ACCOUNT_ID,
          conversationId: CONVERSATION_ID,
          templateName: 'gym_membership_renewal',
          templateLanguage: 'en',
          templateParams: ['Rajat', '30 Sep'],
          templateMessageParams: {
            body: ['Rajat', '30 Sep'],
            headerText: 'September renewal',
            buttonParams: { 0: 'member-42' },
          },
        }),
        { recoverUnauthorizedSession: mockRecoverUnauthorizedSession }
      );
    });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends an overridden COPY_CODE at its original button index', async () => {
    send.mockResolvedValue({
      messageId: 'message-2',
      whatsappMessageId: null,
    });
    renderPicker({ templates: [copyCodeTemplate] });

    fireEvent.changeText(
      screen.getByLabelText('Body variable 1'),
      '  OFFER25 '
    );
    fireEvent.changeText(screen.getByLabelText('Copy offer'), '  CUSTOM25 ');
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          templateParams: ['OFFER25'],
          templateMessageParams: {
            body: ['OFFER25'],
            buttonParams: { 1: 'CUSTOM25' },
          },
        }),
        { recoverUnauthorizedSession: mockRecoverUnauthorizedSession }
      );
    });
  });

  it('sends a valid static template with exact empty positional values', async () => {
    send.mockResolvedValue({
      messageId: 'message-3',
      whatsappMessageId: null,
    });
    renderPicker({ templates: [staticTemplate] });

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'static_notice',
          templateParams: [],
          templateMessageParams: { body: [] },
        }),
        { recoverUnauthorizedSession: mockRecoverUnauthorizedSession }
      );
    });
  });

  it('prevents repeat sends while pending', async () => {
    const attempt = deferred<{ messageId: string; whatsappMessageId: null }>();
    send.mockReturnValue(attempt.promise);
    renderPicker({ templates: [membershipTemplate] });

    fillMembershipFields();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Send template, loading' })
    );
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      attempt.resolve({ messageId: 'message-1', whatsappMessageId: null });
      await attempt.promise;
    });
  });

  it('keeps the selected template and all values after a definite pre-send failure with one retry action', async () => {
    send.mockRejectedValueOnce(
      new MobileSendError('rate_limited', 'Too many send attempts.')
    );
    renderPicker({ templates: [membershipTemplate] });

    fillMembershipFields();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Too many send attempts.'
      );
    });
    expect(screen.getByRole('button', { name: 'Retry send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByLabelText('Body variable 1').props.value).toBe(
      '  Rajat  '
    );
    expect(screen.getByLabelText('Renew now').props.value).toBe('  member-42 ');
    expect(screen.getByText('gym_membership_renewal · Selected')).toBeTruthy();
  });

  it.each([
    ['network', 'Could not reach the send service.'],
    ['provider', 'Message delivery is unavailable.'],
    ['invalid_response', 'The send service returned an invalid response.'],
  ] as const)(
    'withholds template retry after an ambiguous %s outcome',
    async (category, detail) => {
      send.mockRejectedValueOnce(new MobileSendError(category, detail));
      const { onClose, onOutcomeUnknown } = renderPicker({
        templates: [membershipTemplate],
      });

      fillMembershipFields();
      fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          `${detail} Delivery could not be confirmed. Check the conversation before sending again.`
        );
      });
      expect(screen.queryByRole('button', { name: 'Retry send' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Send template' })
      ).toBeNull();
      expect(screen.getByLabelText('Body variable 1').props.value).toBe(
        '  Rajat  '
      );
      expect(screen.getByLabelText('Renew now').props.value).toBe(
        '  member-42 '
      );
      expect(onOutcomeUnknown).toHaveBeenCalledTimes(1);

      fireEvent.press(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps a previous unknown outcome locked until the agent explicitly confirms checking the conversation', () => {
    const { onOutcomeAcknowledged } = renderPicker({
      templates: [membershipTemplate],
      outcomeUnknown: true,
    });

    expect(
      screen.getByText(
        'A previous template send could not be confirmed. Check this conversation for the message before sending another.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry send' })).toBeNull();
    expect(screen.getByLabelText('Body variable 1').props.editable).toBe(false);

    fireEvent.press(
      screen.getByRole('button', { name: 'I checked the conversation' })
    );

    expect(onOutcomeAcknowledged).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
