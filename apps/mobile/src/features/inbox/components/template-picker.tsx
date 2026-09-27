import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import type { ColorValue, KeyboardAvoidingViewProps } from 'react-native';
import { useCSSVariable } from 'uniwind';

import type { LocaleFormatters } from '../../../../../../src/lib/locale/format';
import {
  Button,
  EmptyState,
  IconButton,
  Notice,
  ScreenSafeAreaView,
  SearchField,
  TextField,
} from '../../../ui';
import { Glyph } from '../../../ui/glyph';
import { Text } from '../../../ui/text';
import type { NativeTemplate } from '../inbox-types';
import {
  describeMobileSendFailure,
  type MobileSendFailure,
  sendConversationMessage,
} from '../send-message-client';
import {
  loadTemplateContext,
  mobileTemplateContextSource,
  type TemplateContextSource,
  type TemplateContextState,
} from '../template-context';
import {
  matchesTemplateQuery,
  prefillTemplateValues,
  presentTemplate,
  previewText,
  type TemplateContext,
  type TemplateInput,
  type TemplatePresentation,
  type TemplateValues,
} from '../template-presentation';
import { TemplateMessagePreview } from './template-message-preview';

/** Search earns its row once the list no longer fits on one phone screen. */
const SEARCH_THRESHOLD = 6;

type FieldErrors = Record<string, string>;

export interface TemplateRecipient {
  contactId: string;
  /** The saved name, used to fill a template's name blank. */
  name: string | null;
  /** What the chat header shows: the name, or the formatted phone. */
  displayName: string;
}

export interface TemplatePickerProps {
  accountId: string;
  conversationId: string;
  recipient: TemplateRecipient;
  formatters: Pick<LocaleFormatters, 'date' | 'money'>;
  templates: NativeTemplate[];
  onAttemptStarted(): Promise<void>;
  onClose(): void;
  onOutcomeAcknowledged(): Promise<void>;
  onOutcomeConfirmed(): Promise<void>;
  onSent(): void;
  outcomeUnknown: boolean;
  recoverUnauthorizedSession(): Promise<void>;
  contextSource?: TemplateContextSource;
}

export function keyboardAvoidingBehavior(
  platform: string
): KeyboardAvoidingViewProps['behavior'] {
  return platform === 'ios' ? 'padding' : 'height';
}

function templatePayload(
  presentation: TemplatePresentation,
  values: TemplateValues
) {
  const value = (input: TemplateInput) => values[input.key]?.trim() ?? '';
  const body = presentation.inputs
    .filter((input) => input.field.kind === 'body')
    .map(value);
  const header = presentation.inputs.find(
    (input) => input.field.kind === 'header'
  );
  const buttonEntries = presentation.inputs.flatMap((input) =>
    input.field.kind === 'button'
      ? [[input.field.buttonIndex, value(input)] as const]
      : []
  );

  return {
    kind: 'template' as const,
    templateName: presentation.template.name,
    templateLanguage: presentation.template.language,
    templateParams: body,
    templateMessageParams: {
      body,
      ...(header ? { headerText: value(header) } : {}),
      ...(buttonEntries.length > 0
        ? { buttonParams: Object.fromEntries(buttonEntries) }
        : {}),
    },
  };
}

function templateContext(
  recipient: TemplateRecipient,
  state: TemplateContextState | null
): TemplateContext {
  return {
    contactName: recipient.name,
    legalName:
      state?.legalName.status === 'ready' ? state.legalName.name : null,
    membership:
      state?.membership.status === 'ready' ? state.membership.membership : null,
  };
}

function firstName(recipient: TemplateRecipient): string {
  return recipient.name?.trim().split(/\s+/)[0] || 'this member';
}

interface SheetHeaderProps {
  title: string;
  subtitle: string;
  leading: 'close' | 'back';
  onLeadingPress(): void;
  leadingDisabled: boolean;
}

function SheetHeader({
  title,
  subtitle,
  leading,
  onLeadingPress,
  leadingDisabled,
}: SheetHeaderProps) {
  return (
    <View
      className="bg-inbox-chrome min-h-14 flex-row items-center gap-1 px-2 py-1"
      testID="template-sheet-header"
    >
      <IconButton
        accessibilityLabel={leading === 'close' ? 'Close' : 'Back to templates'}
        isDisabled={leadingDisabled}
        onPress={onLeadingPress}
        symbol={leading === 'close' ? 'xmark' : 'chevron.left'}
        variant="ghost"
      />
      <View className="min-w-0 flex-1 py-1">
        <Text
          accessibilityRole="header"
          className="text-foreground text-base font-semibold"
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text className="text-muted text-sm" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

interface TemplateRowProps {
  disabled: boolean;
  onPress(): void;
  preview: string;
  template: NativeTemplate;
  title: string;
}

function TemplateRow({
  disabled,
  onPress,
  preview,
  template,
  title,
}: TemplateRowProps) {
  const muted = useCSSVariable('--color-muted') as ColorValue | undefined;
  return (
    <Pressable
      accessibilityHint="Opens a preview before sending"
      accessibilityLabel={`${title}. ${preview}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`active:bg-surface-secondary min-h-18 flex-row items-center gap-3 px-4 py-3 ${
        disabled ? 'opacity-50' : ''
      }`}
      disabled={disabled}
      onPress={onPress}
      testID={`template-option-${template.id}`}
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-foreground text-base font-semibold">{title}</Text>
        <Text className="text-muted text-sm" numberOfLines={2}>
          {preview}
        </Text>
      </View>
      <Glyph name="chevron.right" size={16} tintColor={muted} />
    </Pressable>
  );
}

/**
 * Sending an approved template, shaped like the flows owners already know
 * from WhatsApp Business: pick a message from a searchable list that already
 * reads the way the customer will see it, check it as a chat bubble, then
 * press the round send button. Everything the app knows — the member's name,
 * their membership, the gym's legal name — is filled in before they arrive.
 */
export function TemplatePicker({
  accountId,
  conversationId,
  recipient,
  formatters,
  templates,
  onAttemptStarted,
  onClose,
  onOutcomeAcknowledged,
  onOutcomeConfirmed,
  onSent,
  outcomeUnknown,
  recoverUnauthorizedSession,
  contextSource = mobileTemplateContextSource,
}: TemplatePickerProps) {
  const [query, setQuery] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null
  );
  const [edits, setEdits] = useState<TemplateValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [sendFailure, setSendFailure] = useState<MobileSendFailure | null>(
    null
  );
  const [safetyFailure, setSafetyFailure] = useState<string | null>(null);
  const [contextState, setContextState] = useState<TemplateContextState | null>(
    null
  );
  const inFlightRef = useRef(false);
  const currentAttemptOutcomeUnknown = sendFailure?.safeToRetry === false;
  const sendLocked =
    outcomeUnknown || currentAttemptOutcomeUnknown || safetyFailure !== null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadTemplateContext(
        contextSource,
        accountId,
        recipient.contactId
      );
      if (!cancelled) setContextState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, contextSource, recipient.contactId]);

  const context = templateContext(recipient, contextState);
  const presentations = useMemo(
    () => templates.map((template) => presentTemplate(template)),
    [templates]
  );
  const visiblePresentations = presentations.filter((presentation) =>
    matchesTemplateQuery(presentation, query)
  );
  const selected =
    presentations.find(
      (presentation) => presentation.template.id === selectedTemplateId
    ) ?? null;
  const values: TemplateValues = selected
    ? { ...prefillTemplateValues(selected, context, formatters), ...edits }
    : {};
  const editableInputs = selected
    ? selected.inputs.filter((input) => !input.automatic)
    : [];
  const missingCount = editableInputs.filter(
    (input) => !values[input.key]?.trim()
  ).length;
  const legalNameMissing =
    selected?.inputs.some((input) => input.automatic) === true &&
    contextState?.legalName.status === 'missing';
  const contextLoading =
    selected !== null &&
    contextState === null &&
    (selected.usesMembership || selected.usesLegalName);

  const selectTemplate = (presentation: TemplatePresentation) => {
    if (pending || sendLocked) return;
    setSelectedTemplateId(presentation.template.id);
    setEdits({});
    setErrors({});
    setSendFailure(null);
    setSafetyFailure(null);
  };

  const backToList = () => {
    if (pending) return;
    setSelectedTemplateId(null);
    setEdits({});
    setErrors({});
    setSendFailure(null);
  };

  const requestClose = () => {
    if (pending) return;
    if (selected && !sendLocked) {
      backToList();
      return;
    }
    onClose();
  };

  const setFieldValue = (input: TemplateInput, value: string) => {
    setEdits((previous) => ({ ...previous, [input.key]: value }));
    setErrors((previous) => {
      if (!previous[input.key]) return previous;
      const { [input.key]: _removed, ...remaining } = previous;
      return remaining;
    });
    setSendFailure(null);
  };

  const acknowledgeOutcome = async () => {
    if (pending || inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(true);
    setSafetyFailure(null);
    try {
      await onOutcomeAcknowledged();
    } catch {
      setSafetyFailure('Could not unlock sending on this phone. Try again.');
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  const sendTemplate = async () => {
    if (
      pending ||
      inFlightRef.current ||
      !selected ||
      sendLocked ||
      legalNameMissing ||
      contextLoading
    ) {
      return;
    }
    const nextErrors = Object.fromEntries(
      editableInputs.flatMap((input) =>
        values[input.key]?.trim()
          ? []
          : [[input.key, `Enter the ${input.label.toLowerCase()}.`]]
      )
    );
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    inFlightRef.current = true;
    setPending(true);
    setSendFailure(null);
    setSafetyFailure(null);
    try {
      try {
        await onAttemptStarted();
      } catch {
        setSafetyFailure(
          'Nothing was sent. This phone could not save a safety check. Try again later.'
        );
        return;
      }

      try {
        await sendConversationMessage(
          {
            accountId,
            conversationId,
            ...templatePayload(selected, values),
          },
          { recoverUnauthorizedSession }
        );
      } catch (error) {
        const failure = describeMobileSendFailure(error);
        if (failure.safeToRetry) {
          try {
            await onOutcomeConfirmed();
          } catch {
            setSafetyFailure(
              'The template was not sent. Sending is locked on this phone for now. Try again later.'
            );
            return;
          }
        }
        setSendFailure(failure);
        return;
      }

      try {
        await onOutcomeConfirmed();
      } catch {
        onSent();
        setSafetyFailure(
          'The template was sent. Sending is locked on this phone for now. Try again later.'
        );
        return;
      }
      onSent();
      onClose();
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  const recipientLine = `To ${recipient.displayName}`;

  const previousOutcomeNotice =
    outcomeUnknown && !currentAttemptOutcomeUnknown ? (
      <Notice
        action={
          <Button
            accessibilityLabel="I checked the chat"
            className="self-start"
            disabled={pending}
            loading={pending}
            onPress={() => void acknowledgeOutcome()}
            size="sm"
            variant="outline"
          >
            I checked the chat
          </Button>
        }
        symbol="exclamationmark.triangle"
        title="Check the chat first"
      >
        We cannot tell if your last template was sent. Look for it in this chat
        before you send another.
      </Notice>
    ) : null;

  const listStep = (
    <View className="bg-background flex-1">
      {previousOutcomeNotice || safetyFailure ? (
        <View className="gap-3 px-4 pt-3">
          {previousOutcomeNotice}
          {safetyFailure ? (
            <Notice symbol="exclamationmark.triangle" tone="danger">
              {safetyFailure}
            </Notice>
          ) : null}
        </View>
      ) : null}
      {presentations.length >= SEARCH_THRESHOLD ? (
        <View className="px-4 pt-3 pb-1">
          <SearchField
            accessibilityLabel="Search templates"
            onValueChange={setQuery}
            placeholder="Search templates"
            value={query}
          />
        </View>
      ) : null}
      <FlatList
        contentContainerClassName="pb-6"
        data={visiblePresentations}
        ItemSeparatorComponent={() => <View className="bg-border ml-4 h-px" />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(presentation) => presentation.template.id}
        ListEmptyComponent={
          <View className="px-4 py-6">
            <EmptyState
              title="No templates match"
              message="Try another word, or clear the search."
            />
          </View>
        }
        ListHeaderComponent={
          <Text className="text-muted px-4 pt-3 pb-2 text-sm">
            WhatsApp approved these messages in advance. Pick one to check it
            before sending.
          </Text>
        }
        renderItem={({ item }) => (
          <TemplateRow
            disabled={pending || sendLocked}
            onPress={() => selectTemplate(item)}
            preview={previewText(
              item.template.bodyText,
              'body',
              item,
              prefillTemplateValues(item, context, formatters)
            )}
            template={item.template}
            title={item.title}
          />
        )}
        testID="template-list"
      />
    </View>
  );

  const membershipNotice = (() => {
    if (!selected?.usesMembership) return null;
    if (contextState === null) {
      return (
        <Notice emphasis="outline" loading>
          Loading {firstName(recipient)}’s membership…
        </Notice>
      );
    }
    if (contextState.membership.status === 'unavailable') {
      return (
        <Notice emphasis="outline" symbol="exclamationmark.triangle">
          Could not load the membership. Type the details below.
        </Notice>
      );
    }
    if (contextState.membership.membership === null) {
      return (
        <Notice emphasis="outline" symbol="exclamationmark.triangle">
          No membership found for {firstName(recipient)}. Type the details
          below.
        </Notice>
      );
    }
    return (
      <Text className="text-muted text-sm">
        Filled in from {firstName(recipient)}’s membership. Check before
        sending.
      </Text>
    );
  })();

  const composeStep = selected ? (
    <View className="bg-background flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-6"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        testID="template-compose"
      >
        <View className="bg-chat-canvas px-3 py-5">
          <TemplateMessagePreview presentation={selected} values={values} />
        </View>

        <View className="gap-4 px-4 pt-4">
          {membershipNotice}

          {legalNameMissing ? (
            <Notice
              symbol="exclamationmark.triangle"
              title="Legal name missing"
            >
              Add your gym’s legal name on the UsefulDesk website, in Settings →
              Business details. Then send this again.
            </Notice>
          ) : selected.inputs.some((input) => input.automatic) &&
            contextState?.legalName.status !== 'ready' ? (
            <Text className="text-muted text-sm">
              Your gym’s legal name is added when you send.
            </Text>
          ) : null}

          {editableInputs.length > 0 ? (
            <View className="gap-3">
              <Text
                accessibilityRole="header"
                className="text-foreground text-sm font-semibold"
              >
                Details
              </Text>
              {editableInputs.map((input) => (
                <TextField
                  autoCapitalize="sentences"
                  className="text-base"
                  error={errors[input.key]}
                  isDisabled={pending || sendLocked}
                  key={input.key}
                  label={input.label}
                  onChangeText={(value) => setFieldValue(input, value)}
                  placeholder={input.label}
                  value={values[input.key] ?? ''}
                />
              ))}
            </View>
          ) : null}

          {sendFailure ? (
            <Notice symbol="exclamationmark.triangle" tone="danger">
              {sendFailure.message}
            </Notice>
          ) : null}

          {safetyFailure ? (
            <Notice symbol="exclamationmark.triangle" tone="danger">
              {safetyFailure}
            </Notice>
          ) : null}
        </View>
      </ScrollView>

      <View
        className="bg-inbox-panel border-border min-h-16 flex-row items-center gap-3 border-t px-4 py-2"
        testID="template-send-bar"
      >
        {currentAttemptOutcomeUnknown || safetyFailure ? (
          <Button
            accessibilityLabel="Check the chat"
            className="flex-1"
            onPress={onClose}
            variant="outline"
          >
            Check the chat
          </Button>
        ) : (
          <>
            <Text
              accessibilityLiveRegion="polite"
              className="text-muted min-w-0 flex-1 text-sm"
            >
              {legalNameMissing
                ? 'Cannot send yet'
                : missingCount > 0
                  ? `${missingCount} ${missingCount === 1 ? 'detail' : 'details'} left to fill`
                  : sendFailure
                    ? 'Nothing was sent. You can try again.'
                    : `Ready to send to ${recipient.displayName}`}
            </Text>
            <IconButton
              accessibilityLabel={sendFailure ? 'Try again' : 'Send template'}
              isDisabled={legalNameMissing}
              isLoading={pending || contextLoading}
              onPress={() => void sendTemplate()}
              shape="circle"
              symbol="send"
              testID="template-send"
              tone="on-accent"
            />
          </>
        )}
      </View>
    </View>
  ) : null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={requestClose}
      statusBarTranslucent
      visible
    >
      <ScreenSafeAreaView className="bg-inbox-chrome" edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior(Platform.OS)}
          className="flex-1"
        >
          <View accessibilityViewIsModal className="flex-1">
            <SheetHeader
              leading={selected && !sendLocked ? 'back' : 'close'}
              leadingDisabled={pending}
              onLeadingPress={
                selected && !sendLocked ? backToList : requestClose
              }
              subtitle={recipientLine}
              title={selected ? selected.title : 'Choose a template'}
            />
            {selected ? composeStep : listStep}
          </View>
        </KeyboardAvoidingView>
      </ScreenSafeAreaView>
    </Modal>
  );
}
