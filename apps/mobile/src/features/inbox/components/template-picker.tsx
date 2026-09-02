import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { KeyboardAvoidingViewProps } from 'react-native';

import { Button, ScreenSafeAreaView, TextField } from '../../../ui';
import { useReadyAuth } from '../../auth/auth-context';
import type { ActionBlocker } from '../conversation-actions';
import { isAccessibilityTextScale } from '../inbox-layout';
import type { NativeTemplate, TemplateField } from '../inbox-types';
import {
  describeMobileSendFailure,
  type MobileSendFailure,
  sendConversationMessage,
} from '../send-message-client';
import { templateFields } from '../template-repository';

const NO_TEMPLATES_BLOCKER: ActionBlocker = {
  kind: 'local_templates',
  title: 'No sendable templates',
  reason:
    'Add an approved WhatsApp template before sending outside the customer-service window.',
};

const INVALID_TEMPLATES_BLOCKER: ActionBlocker = {
  kind: 'template_contract',
  title: 'Template setup needs attention',
  reason:
    'Sync an approved WhatsApp template contract before sending outside the customer-service window.',
};

type FieldValues = Record<string, string>;
type FieldErrors = Record<string, string>;

export interface TemplatePickerProps {
  accountId: string;
  conversationId: string;
  templates: NativeTemplate[];
  blocker: ActionBlocker | null;
  onAttemptStarted(): Promise<void>;
  onClose(): void;
  onOutcomeAcknowledged(): Promise<void>;
  onOutcomeConfirmed(): Promise<void>;
  onSent(): void;
  outcomeUnknown: boolean;
}

function fieldKey(field: TemplateField): string {
  switch (field.kind) {
    case 'body':
      return `body:${field.variable}`;
    case 'header':
      return 'header';
    case 'button':
      return `button:${field.buttonIndex}`;
  }
}

function valuesForTemplate(template: NativeTemplate): FieldValues {
  return Object.fromEntries(
    templateFields(template).flatMap((field) =>
      field.kind !== 'button' || field.defaultValue === undefined
        ? []
        : [[fieldKey(field), field.defaultValue]]
    )
  );
}

function positionalIndices(text: unknown): number[] | null {
  if (typeof text !== 'string') return null;
  const matches = [...text.matchAll(/\{\{([^}]+)\}\}/g)];
  if (
    matches.some(
      (match) =>
        !/^[1-9]\d*$/.test(match[1]) || !Number.isSafeInteger(Number(match[1]))
    )
  ) {
    return null;
  }
  const withoutPlaceholders = text.replace(/\{\{[1-9]\d*\}\}/g, '');
  if (
    withoutPlaceholders.includes('{{') ||
    withoutPlaceholders.includes('}}')
  ) {
    return null;
  }
  return [...new Set(matches.map((match) => Number(match[1])))].sort(
    (left, right) => left - right
  );
}

function hasContiguousBodyIndices(indices: number[]): boolean {
  return indices.every((index, position) => index === position + 1);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasValidHeader(template: Record<string, unknown>): boolean {
  if (template.headerType === null) return template.headerContent === null;
  if (
    template.headerType !== 'text' ||
    typeof template.headerContent !== 'string' ||
    !template.headerContent.trim()
  ) {
    return false;
  }
  const indices = positionalIndices(template.headerContent);
  return (
    indices !== null &&
    (indices.length === 0 || (indices.length === 1 && indices[0] === 1))
  );
}

function hasValidButton(value: unknown): boolean {
  const button = record(value);
  if (
    !button ||
    typeof button.type !== 'string' ||
    typeof button.text !== 'string' ||
    !button.text.trim()
  ) {
    return false;
  }
  if (button.type === 'URL') {
    const indices = positionalIndices(button.url);
    return (
      typeof button.url === 'string' &&
      indices !== null &&
      (indices.length === 0 || (indices.length === 1 && indices[0] === 1))
    );
  }
  if (button.type === 'COPY_CODE') {
    return typeof button.example === 'string' && Boolean(button.example.trim());
  }
  if (button.type === 'PHONE_NUMBER') {
    return (
      typeof button.phoneNumber === 'string' &&
      Boolean(button.phoneNumber.trim())
    );
  }
  return button.type === 'QUICK_REPLY';
}

function isSendableTemplate(value: unknown): value is NativeTemplate {
  const template = record(value);
  if (!template || !Array.isArray(template.buttons)) return false;
  const bodyIndices = positionalIndices(template.bodyText);
  return (
    template.status === 'APPROVED' &&
    template.parameterFormat === 'POSITIONAL' &&
    template.providerMissingSince === null &&
    template.providerComponentsSyncRequiredAt === null &&
    template.headerMediaUrl === null &&
    typeof template.name === 'string' &&
    Boolean(template.name.trim()) &&
    typeof template.language === 'string' &&
    Boolean(template.language.trim()) &&
    typeof template.bodyText === 'string' &&
    Boolean(template.bodyText.trim()) &&
    bodyIndices !== null &&
    hasContiguousBodyIndices(bodyIndices) &&
    hasValidHeader(template) &&
    template.buttons.every(hasValidButton)
  );
}

export function keyboardAvoidingBehavior(
  platform: string
): KeyboardAvoidingViewProps['behavior'] {
  return platform === 'ios' ? 'padding' : 'height';
}

function resolveBlocker(
  blocker: ActionBlocker | null,
  templates: NativeTemplate[]
): ActionBlocker | null {
  if (blocker) return blocker;
  if (templates.length === 0) return NO_TEMPLATES_BLOCKER;
  return templates.every(isSendableTemplate) ? null : INVALID_TEMPLATES_BLOCKER;
}

function interpolate(
  text: string,
  values: FieldValues,
  prefix: 'body' | 'header'
): string {
  return text.replace(/{{(\d+)}}/g, (token, value) => {
    const replacement = values[`${prefix}:${value}`]?.trim();
    return replacement || token;
  });
}

function templatePayload(
  template: NativeTemplate,
  fields: TemplateField[],
  values: FieldValues
) {
  const body = fields
    .filter(
      (field): field is Extract<TemplateField, { kind: 'body' }> =>
        field.kind === 'body'
    )
    .map((field) => values[fieldKey(field)].trim());
  const header = fields.find(
    (field): field is Extract<TemplateField, { kind: 'header' }> =>
      field.kind === 'header'
  );
  const buttonEntries = fields
    .filter(
      (field): field is Extract<TemplateField, { kind: 'button' }> =>
        field.kind === 'button'
    )
    .map(
      (field) => [field.buttonIndex, values[fieldKey(field)].trim()] as const
    );

  return {
    kind: 'template' as const,
    templateName: template.name,
    templateLanguage: template.language,
    templateParams: body,
    templateMessageParams: {
      body,
      ...(header ? { headerText: values[fieldKey(header)].trim() } : {}),
      ...(buttonEntries.length > 0
        ? { buttonParams: Object.fromEntries(buttonEntries) }
        : {}),
    },
  };
}

export function TemplatePicker({
  accountId,
  conversationId,
  templates,
  blocker,
  onAttemptStarted,
  onClose,
  onOutcomeAcknowledged,
  onOutcomeConfirmed,
  onSent,
  outcomeUnknown,
}: TemplatePickerProps) {
  const auth = useReadyAuth();
  const { fontScale } = useWindowDimensions();
  const accessibilityTextScale = isAccessibilityTextScale(fontScale);
  const resolvedBlocker = resolveBlocker(blocker, templates);
  const firstTemplate = resolvedBlocker ? null : (templates[0] ?? null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    firstTemplate?.id ?? null
  );
  const [values, setValues] = useState<FieldValues>(() =>
    firstTemplate ? valuesForTemplate(firstTemplate) : {}
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [sendFailure, setSendFailure] = useState<MobileSendFailure | null>(
    null
  );
  const [safetyFailure, setSafetyFailure] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const currentAttemptOutcomeUnknown = sendFailure?.safeToRetry === false;
  const sendLocked =
    outcomeUnknown || currentAttemptOutcomeUnknown || safetyFailure !== null;

  const selectedTemplate =
    resolvedBlocker === null
      ? (templates.find((template) => template.id === selectedTemplateId) ??
        templates[0] ??
        null)
      : null;
  const fields = useMemo(
    () => (selectedTemplate ? templateFields(selectedTemplate) : []),
    [selectedTemplate]
  );

  const selectTemplate = (template: NativeTemplate) => {
    if (pending || sendLocked) return;
    setSelectedTemplateId(template.id);
    setValues(valuesForTemplate(template));
    setErrors({});
    setSendFailure(null);
    setSafetyFailure(null);
  };

  const setFieldValue = (field: TemplateField, value: string) => {
    const key = fieldKey(field);
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const { [key]: _removed, ...remaining } = previous;
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
      setSafetyFailure(
        'Could not clear the send-safety lock. Sending remains locked until storage recovers.'
      );
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  const sendTemplate = async () => {
    if (
      pending ||
      inFlightRef.current ||
      !selectedTemplate ||
      resolvedBlocker ||
      sendLocked
    ) {
      return;
    }
    const nextErrors = Object.fromEntries(
      fields.flatMap((field) => {
        const value = values[fieldKey(field)]?.trim();
        return value
          ? []
          : [[fieldKey(field), `Enter a value for ${field.label}.`]];
      })
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
          'Could not save template send safety status. No message was sent. Sending remains locked until storage recovers.'
        );
        return;
      }

      try {
        await sendConversationMessage(
          {
            accountId,
            conversationId,
            ...templatePayload(selectedTemplate, fields, values),
          },
          { recoverUnauthorizedSession: auth.recoverUnauthorizedSession }
        );
      } catch (error) {
        const failure = describeMobileSendFailure(error);
        if (failure.safeToRetry) {
          try {
            await onOutcomeConfirmed();
          } catch {
            setSafetyFailure(
              'The send was rejected, but the send-safety lock could not be cleared. Sending remains locked until storage recovers.'
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
          'The template was sent, but the send-safety lock could not be cleared. Check the conversation. Sending remains locked until storage recovers.'
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

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior(Platform.OS)}
        className="flex-1"
      >
        <ScreenSafeAreaView edges={['bottom']} className="flex-1">
          <View className="flex-1 justify-end bg-black/40">
            <View
              accessibilityViewIsModal
              className="bg-background max-h-[90%] rounded-t-2xl px-4 pt-4"
            >
              <View
                className={`mb-4 gap-3 ${
                  accessibilityTextScale
                    ? 'items-start'
                    : 'flex-row items-center justify-between'
                }`}
              >
                <Text
                  className={`text-foreground text-lg font-semibold ${
                    accessibilityTextScale ? '' : 'flex-1'
                  }`}
                  style={{ lineHeight: undefined }}
                >
                  Send approved template
                </Text>
                <Button
                  accessibilityLabel="Cancel"
                  className="min-w-12 self-start"
                  disabled={pending}
                  onPress={onClose}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </View>

              {resolvedBlocker ? (
                <View
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  className="bg-warning-soft gap-1 rounded-xl px-3 py-3"
                >
                  <Text
                    className="text-warning-soft-foreground text-base font-semibold"
                    style={{ lineHeight: undefined }}
                  >
                    {resolvedBlocker.title}
                  </Text>
                  <Text
                    className="text-warning-soft-foreground text-sm"
                    style={{ lineHeight: undefined }}
                  >
                    {resolvedBlocker.reason}
                  </Text>
                </View>
              ) : selectedTemplate ? (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerClassName="gap-4 pb-4"
                >
                  <View className="gap-2">
                    <Text
                      className="text-foreground text-sm font-medium"
                      style={{ lineHeight: undefined }}
                    >
                      Approved templates
                    </Text>
                    {templates.map((template) => {
                      const selected = template.id === selectedTemplate.id;
                      return (
                        <View
                          key={template.id}
                          accessible
                          accessibilityLabel={`${template.name}, Approved${selected ? ', Selected' : ''}`}
                          accessibilityRole="button"
                          accessibilityState={{
                            disabled: pending || sendLocked,
                            selected,
                          }}
                          onAccessibilityTap={() => selectTemplate(template)}
                        >
                          <Button
                            accessible={false}
                            className="w-full justify-start px-3"
                            disabled={pending || sendLocked}
                            onPress={() => selectTemplate(template)}
                            testID={`template-option-${template.id}`}
                            variant={selected ? 'primary' : 'outline'}
                          >
                            {selected
                              ? `${template.name} · Selected`
                              : template.name}
                          </Button>
                        </View>
                      );
                    })}
                  </View>

                  <View
                    className="bg-surface-secondary gap-2 rounded-xl px-3 py-3"
                    testID="template-preview"
                  >
                    <Text
                      className="text-surface-secondary-foreground text-sm font-medium"
                      style={{ lineHeight: undefined }}
                    >
                      Preview
                    </Text>
                    {selectedTemplate.headerType === 'text' &&
                    selectedTemplate.headerContent ? (
                      <Text
                        className="text-surface-secondary-foreground text-base font-semibold"
                        style={{ lineHeight: undefined }}
                      >
                        {interpolate(
                          selectedTemplate.headerContent,
                          values,
                          'header'
                        )}
                      </Text>
                    ) : null}
                    <Text
                      className="text-surface-secondary-foreground text-sm"
                      style={{ lineHeight: undefined }}
                    >
                      {interpolate(selectedTemplate.bodyText, values, 'body')}
                    </Text>
                    <Text
                      className="text-surface-secondary-foreground text-xs"
                      style={{ lineHeight: undefined }}
                    >
                      Approved
                    </Text>
                  </View>

                  {fields.length > 0 ? (
                    <View className="gap-3">
                      <Text
                        className="text-foreground text-sm font-medium"
                        style={{ lineHeight: undefined }}
                      >
                        Template values
                      </Text>
                      {fields.map((field) => {
                        const key = fieldKey(field);
                        return (
                          <TextField
                            key={key}
                            autoCapitalize="sentences"
                            className="text-base"
                            error={errors[key]}
                            isDisabled={pending || sendLocked}
                            label={field.label}
                            onChangeText={(value) =>
                              setFieldValue(field, value)
                            }
                            placeholder={field.label}
                            value={values[key] ?? ''}
                          />
                        );
                      })}
                    </View>
                  ) : null}

                  {sendFailure ? (
                    <View
                      accessible
                      accessibilityLiveRegion="polite"
                      accessibilityRole="alert"
                      className="bg-danger-soft rounded-xl px-3 py-3"
                    >
                      <Text
                        className="text-danger-soft-foreground text-sm"
                        style={{ lineHeight: undefined }}
                      >
                        {sendFailure.message}
                      </Text>
                    </View>
                  ) : null}

                  {safetyFailure ? (
                    <View
                      accessible
                      accessibilityLiveRegion="polite"
                      accessibilityRole="alert"
                      className="bg-danger-soft rounded-xl px-3 py-3"
                    >
                      <Text
                        className="text-danger-soft-foreground text-sm"
                        style={{ lineHeight: undefined }}
                      >
                        {safetyFailure}
                      </Text>
                    </View>
                  ) : null}

                  {outcomeUnknown && !currentAttemptOutcomeUnknown ? (
                    <View className="gap-3">
                      <View
                        accessible
                        accessibilityLiveRegion="polite"
                        accessibilityRole="alert"
                        className="bg-warning-soft gap-1 rounded-xl px-3 py-3"
                      >
                        <Text
                          className="text-warning-soft-foreground text-base font-semibold"
                          style={{ lineHeight: undefined }}
                        >
                          Check the conversation first
                        </Text>
                        <Text
                          className="text-warning-soft-foreground text-sm"
                          style={{ lineHeight: undefined }}
                        >
                          A previous template send could not be confirmed. Check
                          this conversation for the message before sending
                          another.
                        </Text>
                      </View>
                      <Button
                        accessibilityLabel="I checked the conversation"
                        disabled={pending}
                        loading={pending}
                        onPress={() => void acknowledgeOutcome()}
                        variant="outline"
                      >
                        I checked the conversation
                      </Button>
                    </View>
                  ) : currentAttemptOutcomeUnknown || safetyFailure ? (
                    <Button
                      accessibilityLabel="Close"
                      onPress={onClose}
                      variant="outline"
                    >
                      Close
                    </Button>
                  ) : (
                    <Button
                      accessibilityLabel={
                        pending
                          ? `${sendFailure ? 'Retry send' : 'Send template'}, loading`
                          : sendFailure
                            ? 'Retry send'
                            : 'Send template'
                      }
                      disabled={pending}
                      loading={pending}
                      onPress={() => void sendTemplate()}
                    >
                      {sendFailure ? 'Retry send' : 'Send template'}
                    </Button>
                  )}
                </ScrollView>
              ) : null}
            </View>
          </View>
        </ScreenSafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
