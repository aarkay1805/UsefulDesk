import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { ScrollView, TextInput } from 'react-native';

import type { NativeTemplate } from '../inbox-types';
import {
  MobileSendError,
  sendConversationMessage,
} from '../send-message-client';
import type { TemplateContextSource } from '../template-context';
import { keyboardAvoidingBehavior, TemplatePicker } from './template-picker';

const ACCOUNT_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';
const CONTACT_ID = '1b1f7d0e-7fd4-4a5d-9a0f-0c5b0d3c9f11';
const LEGAL_NAME = 'Iron House Fitness Private Limited';
const mockRecoverUnauthorizedSession = jest.fn().mockResolvedValue(undefined);

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: View,
  };
});

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
    return React.createElement(View, null, children);
  };
  MockLabel.Text = function MockLabelText({
    children,
    style,
  }: import('react').PropsWithChildren<{
    style?: import('react-native').TextStyle;
  }>) {
    currentFieldLabel = String(children);
    return React.createElement(Text, { style }, children);
  };
  const MockInput = ({ isDisabled, ...props }: any) =>
    React.createElement(TextInput, {
      ...props,
      accessibilityLabel: currentFieldLabel,
      editable: !isDisabled,
    });
  const MockFieldError = ({ children }: import('react').PropsWithChildren) =>
    React.createElement(Text, { accessibilityRole: 'alert' }, children);

  let searchOnChange: ((value: string) => void) | undefined;
  function MockSearchField({
    children,
    onChange,
  }: import('react').PropsWithChildren<{
    onChange?: (value: string) => void;
  }>) {
    searchOnChange = onChange;
    return React.createElement(View, null, children);
  }
  MockSearchField.Group = function MockSearchFieldGroup({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  };
  MockSearchField.SearchIcon = function MockSearchFieldSearchIcon() {
    return null;
  };
  MockSearchField.Input = function MockSearchFieldInput(
    props: import('react-native').TextInputProps
  ) {
    return React.createElement(TextInput, {
      ...props,
      onChangeText: searchOnChange,
    });
  };
  MockSearchField.ClearButton = function MockSearchFieldClearButton() {
    return null;
  };

  function MockAlert(props: import('react-native').ViewProps) {
    return React.createElement(View, { ...props, accessibilityRole: 'alert' });
  }
  MockAlert.Indicator = function MockAlertIndicator() {
    return null;
  };
  MockAlert.Content = function MockAlertContent({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  };
  MockAlert.Title = function MockAlertTitle({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };
  MockAlert.Description = function MockAlertDescription({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  return {
    Alert: MockAlert,
    Button: MockButton,
    FieldError: MockFieldError,
    Input: MockInput,
    Label: MockLabel,
    SearchField: MockSearchField,
    TextField: MockTextField,
  };
});

jest.mock('../send-message-client', () => ({
  ...jest.requireActual('../send-message-client'),
  sendConversationMessage: jest.fn(),
}));

const send = jest.mocked(sendConversationMessage);

const fmt = {
  date: (value: unknown) => (value === '2026-09-30' ? '30 Sep 2026' : '?'),
  money: (value: number) => `₹${value.toLocaleString('en-US')}`,
};

const renewalTemplate: NativeTemplate = {
  id: 'template-renewal',
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
};

const customTemplate: NativeTemplate = {
  ...renewalTemplate,
  id: 'template-custom',
  name: 'gym_diwali_offer',
  category: 'Marketing',
  bodyText: 'Hi {{1}}, your Diwali offer ends {{2}}.',
  footerText: null,
  headerType: 'text',
  headerContent: '{{1}}',
  buttons: [
    { type: 'URL', text: 'Renew now', url: 'https://pay.example.test/{{1}}' },
    { type: 'QUICK_REPLY', text: 'Talk to us' },
    { type: 'COPY_CODE', text: 'Copy offer', example: 'WELCOME20' },
  ],
};

const staticTemplate: NativeTemplate = {
  ...renewalTemplate,
  id: 'template-static',
  name: 'static_notice',
  bodyText: 'The gym opens at 6 AM.',
  footerText: null,
  buttons: [],
};

function contextSource(
  overrides: Partial<TemplateContextSource> = {}
): TemplateContextSource {
  return {
    loadLegalName: jest.fn().mockResolvedValue({ ok: true, name: LEGAL_NAME }),
    loadMembership: jest.fn().mockResolvedValue({
      end_date: '2026-09-30',
      fee_amount: 4500,
      plan: { name: 'Gold 3 months' },
    }),
    ...overrides,
  };
}

async function renderPicker(options?: {
  templates?: NativeTemplate[];
  outcomeUnknown?: boolean;
  onAttemptStarted?: jest.Mock;
  onClose?: jest.Mock;
  onOutcomeAcknowledged?: jest.Mock;
  onOutcomeConfirmed?: jest.Mock;
  onSent?: jest.Mock;
  source?: TemplateContextSource;
  contactName?: string | null;
}) {
  const onAttemptStarted =
    options?.onAttemptStarted ?? jest.fn().mockResolvedValue(undefined);
  const onClose = options?.onClose ?? jest.fn();
  const onOutcomeAcknowledged =
    options?.onOutcomeAcknowledged ?? jest.fn().mockResolvedValue(undefined);
  const onOutcomeConfirmed =
    options?.onOutcomeConfirmed ?? jest.fn().mockResolvedValue(undefined);
  const onSent = options?.onSent ?? jest.fn();
  const contactName =
    options && 'contactName' in options ? options.contactName : 'Rahul Sharma';
  render(
    <TemplatePicker
      accountId={ACCOUNT_ID}
      contextSource={options?.source ?? contextSource()}
      conversationId={CONVERSATION_ID}
      formatters={fmt}
      onAttemptStarted={onAttemptStarted}
      onClose={onClose}
      onOutcomeAcknowledged={onOutcomeAcknowledged}
      onOutcomeConfirmed={onOutcomeConfirmed}
      onSent={onSent}
      outcomeUnknown={options?.outcomeUnknown ?? false}
      recoverUnauthorizedSession={mockRecoverUnauthorizedSession}
      recipient={{
        contactId: CONTACT_ID,
        displayName: contactName ?? '+91 98765 43210',
        name: contactName ?? null,
      }}
      templates={
        options?.templates ?? [renewalTemplate, customTemplate, staticTemplate]
      }
    />
  );
  // Let the member's details finish loading, as they do on a phone.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    onAttemptStarted,
    onClose,
    onOutcomeAcknowledged,
    onOutcomeConfirmed,
    onSent,
  };
}

async function openTemplate(title: string) {
  fireEvent.press(
    await screen.findByRole('button', { name: new RegExp(`^${title}\\.`) })
  );
  expect(await screen.findByTestId('template-compose')).toBeTruthy();
}

async function waitForContext() {
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Send template, loading' })
    ).toBeNull()
  );
}

function fillCustomFields() {
  fireEvent.changeText(screen.getByLabelText('Message detail 1'), '  Rajat  ');
  fireEvent.changeText(screen.getByLabelText('Message detail 2'), '  30 Sep ');
  fireEvent.changeText(
    screen.getByLabelText('Title text'),
    '  September renewal '
  );
  fireEvent.changeText(
    screen.getByLabelText('Link for the “Renew now” button'),
    '  member-42 '
  );
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

  it('uses native keyboard avoidance for both supported platforms', () => {
    expect(keyboardAvoidingBehavior('ios')).toBe('padding');
    expect(keyboardAvoidingBehavior('android')).toBe('height');
  });

  it('lists templates by readable name with a preview written for this member', async () => {
    await renderPicker();

    expect(screen.getByText('Choose a template')).toBeTruthy();
    expect(screen.getByText('To Rahul Sharma')).toBeTruthy();
    const row = await screen.findByTestId('template-option-template-renewal');
    expect(within(row).getByText('Membership renewal')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(row).getByText(
          `Hi Rahul Sharma, your Gold 3 months membership ends on 30 Sep 2026. Current renewal price: ₹4,500. Reply to ${LEGAL_NAME} for help renewing.`
        )
      ).toBeTruthy()
    );
    expect(screen.getByText('Diwali offer')).toBeTruthy();
    expect(screen.queryByText('gym_membership_renewal')).toBeNull();
    // Nothing is chosen for the reader, and nothing can be sent from the list.
    expect(screen.queryByTestId('template-compose')).toBeNull();
    expect(screen.queryByTestId('template-send')).toBeNull();
    // Three templates fit on one screen; search is not worth its row yet.
    expect(screen.queryByLabelText('Search templates')).toBeNull();
  });

  it('searches a long list by name and message, and says when nothing matches', async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...staticTemplate,
      id: `template-${index}`,
      name: `notice_${index}`,
      bodyText: index === 3 ? 'Pool closed for cleaning.' : 'Gym is open.',
    }));
    await renderPicker({ templates: [renewalTemplate, ...many] });

    fireEvent.changeText(screen.getByLabelText('Search templates'), 'pool');
    expect(screen.getByText('Notice 3')).toBeTruthy();
    expect(screen.queryByText('Notice 1')).toBeNull();
    expect(screen.queryByText('Membership renewal')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Search templates'), 'renewal');
    expect(screen.getByText('Membership renewal')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Search templates'), 'yoga');
    expect(screen.getByText('No templates match')).toBeTruthy();
  });

  it('opens a chat-bubble preview filled from the membership, and goes back to the list', async () => {
    await renderPicker();
    await openTemplate('Membership renewal');
    await waitForContext();

    expect(screen.getByText('Membership renewal')).toBeTruthy();
    expect(screen.getByTestId('template-preview-body')).toHaveTextContent(
      `Hi Rahul Sharma, your Gold 3 months membership ends on 30 Sep 2026. Current renewal price: ₹4,500. Reply to ${LEGAL_NAME} for help renewing.`
    );
    expect(screen.getByText('Help me renew')).toBeTruthy();
    expect(
      screen.getByText(
        'Filled in from Rahul’s membership. Check before sending.'
      )
    ).toBeTruthy();
    expect(screen.getByLabelText('Plan name').props.value).toBe(
      'Gold 3 months'
    );
    // The server adds the legal name itself; it is never a field to type.
    expect(screen.queryByLabelText('Legal business name')).toBeNull();
    expect(screen.getByText('Ready to send to Rahul Sharma')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Back to templates' }));
    expect(screen.queryByTestId('template-compose')).toBeNull();
    expect(screen.getByText('Choose a template')).toBeTruthy();
  });

  it('sends the previewed values, including the legal name, in positional order', async () => {
    send.mockResolvedValue({ messageId: 'message-1', whatsappMessageId: null });
    const { onClose, onSent } = await renderPicker();
    await openTemplate('Membership renewal');
    await waitForContext();

    fireEvent.changeText(screen.getByLabelText('Plan name'), '  Gold yearly ');
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const body = [
      'Rahul Sharma',
      'Gold yearly',
      '30 Sep 2026',
      '₹4,500',
      LEGAL_NAME,
    ];
    expect(send).toHaveBeenCalledWith(
      {
        accountId: ACCOUNT_ID,
        conversationId: CONVERSATION_ID,
        kind: 'template',
        templateName: 'gym_membership_renewal',
        templateLanguage: 'en_US',
        templateParams: body,
        templateMessageParams: { body },
      },
      { recoverUnauthorizedSession: mockRecoverUnauthorizedSession }
    );
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('asks for what it could not find, naming the member', async () => {
    await renderPicker({
      source: contextSource({
        loadMembership: jest.fn().mockResolvedValue(null),
      }),
    });
    await openTemplate('Membership renewal');
    await waitForContext();

    expect(
      screen.getByText('No membership found for Rahul. Type the details below.')
    ).toBeTruthy();
    expect(screen.getByText('3 details left to fill')).toBeTruthy();
    expect(screen.getByTestId('template-preview-body')).toHaveTextContent(
      /your \[Plan name\] membership ends on \[Membership end date\]/
    );

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));
    expect(screen.getAllByText('Enter the plan name.')).toHaveLength(2);
    expect(
      within(screen.getByTestId('template-send-bar')).getByText(
        'Enter the plan name.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Enter the membership end date.')).toBeTruthy();
    expect(screen.getByText('Enter the current renewal price.')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Plan name'), 'Gold');
    expect(screen.queryByText('Enter the plan name.')).toBeNull();
    expect(
      within(screen.getByTestId('template-send-bar')).getByText(
        'Enter the membership end date.'
      )
    ).toBeTruthy();
  });

  it('focuses and scrolls to the first missing detail on validation failure', async () => {
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const frame = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(
        (callback: Parameters<typeof requestAnimationFrame>[0]) => {
          callback(0);
          return 1;
        }
      );
    try {
      await renderPicker({
        source: contextSource({
          loadMembership: jest.fn().mockResolvedValue(null),
        }),
      });
      await openTemplate('Membership renewal');
      await waitForContext();

      fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

      expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
      expect(focus).toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally {
      frame.mockRestore();
      scrollTo.mockRestore();
      focus.mockRestore();
    }
  });

  it('explains an older known template and keeps a compatible sibling available', async () => {
    const older = {
      ...renewalTemplate,
      id: 'template-older',
      bodyText: 'Hi {{1}}, your {{2}} membership ends on {{3}}. Fee {{4}}.',
    };
    await renderPicker({
      templates: [older, renewalTemplate],
    });

    const olderRow = screen.getByTestId('template-option-template-older');
    expect(within(olderRow).getByText('Template needs an update')).toBeTruthy();
    expect(within(olderRow).queryByText(/Message detail 1/)).toBeNull();
    fireEvent.press(olderRow);

    expect(screen.getByText('To Rahul Sharma')).toBeTruthy();
    expect(screen.getByText('Template needs an update')).toBeTruthy();
    expect(screen.queryByLabelText('Message detail 1')).toBeNull();
    expect(screen.queryByTestId('template-send')).toBeNull();
    expect(send).not.toHaveBeenCalled();

    fireEvent.press(
      screen.getByRole('button', { name: 'Choose another template' })
    );
    fireEvent.press(screen.getByTestId('template-option-template-renewal'));
    expect(screen.getByTestId('template-send')).toBeTruthy();
    expect(screen.getByText('Ready to send to Rahul Sharma')).toBeTruthy();
  });

  it('blocks sending when the gym has no legal name, before WhatsApp can refuse it', async () => {
    await renderPicker({
      source: contextSource({
        loadLegalName: jest.fn().mockResolvedValue({
          ok: false,
          code: 'legal_business_identity_missing',
        }),
      }),
    });
    await openTemplate('Membership renewal');

    expect(await screen.findByText('Legal name missing')).toBeTruthy();
    expect(screen.getByText('Cannot send yet')).toBeTruthy();
    const sendButton = screen.getByRole('button', { name: 'Send template' });
    expect(sendButton.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(sendButton);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends exact trimmed body, header, and original button-index values', async () => {
    send.mockResolvedValue({ messageId: 'message-1', whatsappMessageId: null });
    await renderPicker({ contactName: null });
    await openTemplate('Diwali offer');

    expect(screen.getByText('Check each detail')).toBeTruthy();
    expect(
      screen.getByText(
        'This message has numbered blanks. Fill each one and check the preview.'
      )
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Code for the “Copy offer” button').props.value
    ).toBe('WELCOME20');
    fillCustomFields();
    fireEvent.changeText(
      screen.getByLabelText('Code for the “Copy offer” button'),
      '  DIWALI10 '
    );
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toEqual({
      accountId: ACCOUNT_ID,
      conversationId: CONVERSATION_ID,
      kind: 'template',
      templateName: 'gym_diwali_offer',
      templateLanguage: 'en_US',
      templateParams: ['Rajat', '30 Sep'],
      templateMessageParams: {
        body: ['Rajat', '30 Sep'],
        headerText: 'September renewal',
        buttonParams: { 0: 'member-42', 2: 'DIWALI10' },
      },
    });
  });

  it('sends a template with no blanks with exact empty positional values', async () => {
    send.mockResolvedValue({ messageId: 'message-1', whatsappMessageId: null });
    await renderPicker();
    await openTemplate('Static notice');

    expect(screen.queryByText('Details')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      templateName: 'static_notice',
      templateParams: [],
      templateMessageParams: { body: [] },
    });
  });

  it('prevents repeat sends while pending', async () => {
    const attempt = deferred<{ messageId: string; whatsappMessageId: null }>();
    send.mockReturnValue(attempt.promise);
    await renderPicker();
    await openTemplate('Static notice');

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    fireEvent.press(
      screen.getByRole('button', { name: 'Send template, loading' })
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Back to templates' }).props
        .accessibilityState.disabled
    ).toBe(true);

    await act(async () => {
      attempt.resolve({ messageId: 'message-1', whatsappMessageId: null });
      await attempt.promise;
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Send template, loading' })
      ).toBeNull()
    );
  });

  it('persists the uncertainty marker before the network send', async () => {
    const marker = deferred<void>();
    const onAttemptStarted = jest.fn(() => marker.promise);
    send.mockResolvedValue({ messageId: 'message-1', whatsappMessageId: null });
    const { onClose } = await renderPicker({ onAttemptStarted });
    await openTemplate('Static notice');

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    expect(onAttemptStarted).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Back to templates' }).props
        .accessibilityState.disabled
    ).toBe(true);

    await act(async () => {
      marker.resolve();
      await marker.promise;
    });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(onAttemptStarted.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not send when the uncertainty marker cannot be persisted', async () => {
    const onAttemptStarted = jest
      .fn()
      .mockRejectedValue(new Error('SecureStore unavailable'));
    await renderPicker({ onAttemptStarted });
    await openTemplate('Static notice');

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    expect(
      await screen.findByText(
        'Nothing was sent. This phone could not save a safety check. Try again later.'
      )
    ).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check the chat' })).toBeTruthy();
  });

  it('keeps the template and every value after a definite pre-send failure, with one retry', async () => {
    send.mockRejectedValueOnce(
      new MobileSendError(
        'rate_limited',
        'Too many messages at once. Wait a minute and try again.'
      )
    );
    const { onOutcomeConfirmed } = await renderPicker({ contactName: null });
    await openTemplate('Diwali offer');

    fillCustomFields();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'Too many messages at once. Wait a minute and try again.'
        )
      ).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check the chat' })).toBeNull();
    expect(screen.getByLabelText('Message detail 1').props.value).toBe(
      '  Rajat  '
    );
    expect(
      screen.getByLabelText('Link for the “Renew now” button').props.value
    ).toBe('  member-42 ');
    expect(onOutcomeConfirmed).toHaveBeenCalledTimes(1);
  });

  it('keeps sending locked when a definite outcome marker cannot be cleared', async () => {
    send.mockRejectedValueOnce(
      new MobileSendError(
        'rate_limited',
        'Too many messages at once. Wait a minute and try again.'
      )
    );
    const onOutcomeConfirmed = jest
      .fn()
      .mockRejectedValue(new Error('SecureStore unavailable'));
    await renderPicker({ onOutcomeConfirmed });
    await openTemplate('Static notice');

    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    expect(
      await screen.findByText(
        'The template was not sent. Sending is locked on this phone for now. Try again later.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
  });

  it.each([
    ['network', 'Could not connect. Check your internet.'],
    ['provider', 'Something went wrong while sending.'],
    ['invalid_response', 'Something went wrong while sending.'],
  ] as const)(
    'withholds template retry after an ambiguous %s outcome',
    async (category, detail) => {
      send.mockRejectedValueOnce(new MobileSendError(category, detail));
      const { onAttemptStarted, onClose, onOutcomeConfirmed } =
        await renderPicker({
          contactName: null,
        });
      await openTemplate('Diwali offer');

      fillCustomFields();
      fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

      await waitFor(() =>
        expect(
          screen.getByText(
            `${detail} We cannot tell if it was sent. Check the chat before you send it again.`
          )
        ).toBeTruthy()
      );
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Send template' })
      ).toBeNull();
      expect(screen.getByLabelText('Message detail 1').props.value).toBe(
        '  Rajat  '
      );
      expect(onAttemptStarted).toHaveBeenCalledTimes(1);
      expect(onOutcomeConfirmed).not.toHaveBeenCalled();
      // No way back to pick a different template while the outcome is unknown.
      expect(
        screen.queryByRole('button', { name: 'Back to templates' })
      ).toBeNull();

      fireEvent.press(screen.getByRole('button', { name: 'Check the chat' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps a previous unknown outcome locked until the agent confirms checking the chat', async () => {
    const { onOutcomeAcknowledged } = await renderPicker({
      outcomeUnknown: true,
    });

    expect(
      screen.getByText(
        'We cannot tell if your last template was sent. Look for it in this chat before you send another.'
      )
    ).toBeTruthy();
    const row = await screen.findByTestId('template-option-template-renewal');
    expect(row.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(row);
    expect(screen.queryByTestId('template-compose')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'I checked the chat' }));

    await waitFor(() => expect(onOutcomeAcknowledged).toHaveBeenCalledTimes(1));
    expect(send).not.toHaveBeenCalled();
  });
});
