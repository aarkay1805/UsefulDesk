import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { KeyboardAvoidingViewProps } from 'react-native';

import { Button, ScreenSafeAreaView, TextField } from '../../../ui';
import { useReadyAuth } from '../../auth/auth-context';
import type { ActionBlocker } from '../conversation-actions';
import type { NativeTemplate, TemplateField } from '../inbox-types';
import { sendConversationMessage } from '../send-message-client';
import { templateFields } from '../template-repository';

const SEND_FAILURE_MESSAGE =
  'Could not send this template. Check your connection and try again.';

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
  onClose(): void;
  onSent(): void;
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

function hasValidHeader(template: NativeTemplate): boolean {
  if (template.headerType === null) return template.headerContent === null;
  if (template.headerType !== 'text' || !template.headerContent?.trim()) {
    return false;
  }
  const indices = positionalIndices(template.headerContent);
  return (
    indices !== null &&
    (indices.length === 0 || (indices.length === 1 && indices[0] === 1))
  );
}

function isSendableTemplate(value: NativeTemplate): boolean {
  const bodyIndices = positionalIndices(value.bodyText);
  return (
    value.status === 'APPROVED' &&
    value.parameterFormat === 'POSITIONAL' &&
    value.providerMissingSince === null &&
    value.providerComponentsSyncRequiredAt === null &&
    value.headerMediaUrl === null &&
    typeof value.name === 'string' &&
    Boolean(value.name.trim()) &&
    typeof value.language === 'string' &&
    Boolean(value.language.trim()) &&
    typeof value.bodyText === 'string' &&
    Boolean(value.bodyText.trim()) &&
    bodyIndices !== null &&
    hasContiguousBodyIndices(bodyIndices) &&
    hasValidHeader(value) &&
    value.buttons.every((button) => {
      if (typeof button.text !== 'string' || !button.text.trim()) return false;
      if (button.type === 'URL') {
        const indices = positionalIndices(button.url);
        return (
          typeof button.url === 'string' &&
          indices !== null &&
          (indices.length === 0 || (indices.length === 1 && indices[0] === 1))
        );
      }
      if (button.type === 'COPY_CODE')
        return (
          typeof button.example === 'string' && Boolean(button.example.trim())
        );
      if (button.type === 'PHONE_NUMBER')
        return (
          typeof button.phoneNumber === 'string' &&
          Boolean(button.phoneNumber.trim())
        );
      return button.type === 'QUICK_REPLY';
    })
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
  onClose,
  onSent,
}: TemplatePickerProps) {
  const auth = useReadyAuth();
  const resolvedBlocker = resolveBlocker(blocker, templates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    templates[0]?.id ?? null
  );
  const [values, setValues] = useState<FieldValues>(() =>
    templates[0] ? valuesForTemplate(templates[0]) : {}
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const inFlightRef = useRef(false);

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ??
    templates[0] ??
    null;
  const fields = useMemo(
    () => (selectedTemplate ? templateFields(selectedTemplate) : []),
    [selectedTemplate]
  );

  const selectTemplate = (template: NativeTemplate) => {
    if (pending) return;
    setSelectedTemplateId(template.id);
    setValues(valuesForTemplate(template));
    setErrors({});
    setSendFailed(false);
  };

  const setFieldValue = (field: TemplateField, value: string) => {
    const key = fieldKey(field);
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const { [key]: _removed, ...remaining } = previous;
      return remaining;
    });
    setSendFailed(false);
  };

  const sendTemplate = async () => {
    if (
      pending ||
      inFlightRef.current ||
      !selectedTemplate ||
      resolvedBlocker
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
    setSendFailed(false);
    try {
      await sendConversationMessage(
        {
          accountId,
          conversationId,
          ...templatePayload(selectedTemplate, fields, values),
        },
        { recoverUnauthorizedSession: auth.recoverUnauthorizedSession }
      );
      onSent();
      onClose();
    } catch {
      setSendFailed(true);
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
              <View className="mb-4 flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-lg font-semibold">
                  Send approved template
                </Text>
                <Button
                  accessibilityLabel="Cancel"
                  className="min-h-11 min-w-11"
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
                  <Text className="text-warning-soft-foreground text-base font-semibold">
                    {resolvedBlocker.title}
                  </Text>
                  <Text className="text-warning-soft-foreground text-sm leading-5">
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
                    <Text className="text-muted text-sm font-medium">
                      Approved templates
                    </Text>
                    {templates.map((template) => {
                      const selected = template.id === selectedTemplate.id;
                      return (
                        <Button
                          key={template.id}
                          accessibilityLabel={`${template.name}, Approved`}
                          className="min-h-11 justify-start px-3"
                          disabled={pending}
                          onPress={() => selectTemplate(template)}
                          variant={selected ? 'primary' : 'outline'}
                        >
                          {template.name}
                        </Button>
                      );
                    })}
                  </View>

                  <View className="bg-muted gap-2 rounded-xl px-3 py-3">
                    <Text className="text-muted text-sm font-medium">
                      Preview
                    </Text>
                    {selectedTemplate.headerType === 'text' &&
                    selectedTemplate.headerContent ? (
                      <Text className="text-base font-semibold">
                        {interpolate(
                          selectedTemplate.headerContent,
                          values,
                          'header'
                        )}
                      </Text>
                    ) : null}
                    <Text className="text-sm leading-5">
                      {interpolate(selectedTemplate.bodyText, values, 'body')}
                    </Text>
                    <Text className="text-muted text-xs">Approved</Text>
                  </View>

                  {fields.length > 0 ? (
                    <View className="gap-3">
                      <Text className="text-muted text-sm font-medium">
                        Template values
                      </Text>
                      {fields.map((field) => {
                        const key = fieldKey(field);
                        return (
                          <TextField
                            key={key}
                            autoCapitalize="sentences"
                            className="min-h-11 text-base"
                            error={errors[key]}
                            isDisabled={pending}
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

                  {sendFailed ? (
                    <View
                      accessible
                      accessibilityLiveRegion="polite"
                      accessibilityRole="alert"
                      className="bg-danger-soft rounded-xl px-3 py-3"
                    >
                      <Text className="text-danger-soft-foreground text-sm leading-5">
                        {SEND_FAILURE_MESSAGE}
                      </Text>
                    </View>
                  ) : null}

                  <Button
                    accessibilityLabel={
                      pending
                        ? `${sendFailed ? 'Retry send' : 'Send template'}, loading`
                        : sendFailed
                          ? 'Retry send'
                          : 'Send template'
                    }
                    className="min-h-11"
                    disabled={pending}
                    loading={pending}
                    onPress={() => void sendTemplate()}
                  >
                    {sendFailed ? 'Retry send' : 'Send template'}
                  </Button>
                </ScrollView>
              ) : null}
            </View>
          </View>
        </ScreenSafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
