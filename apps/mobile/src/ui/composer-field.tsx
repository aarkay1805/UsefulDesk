import { forwardRef } from 'react';
import type { TextInput as TextInputType } from 'react-native';
import {
  FieldError,
  Input,
  Label,
  TextField as HeroTextField,
  type InputProps,
} from 'heroui-native';

import {
  textScaleMeasurementMultiplier,
  useTextScale,
} from './use-text-scale';

/**
 * The chat composer's pill.
 *
 * heroui's `Input` rings a focused field in the account accent
 * (`ios:focus:outline-accent`, `android:focus:border-accent`). That is right
 * for a form, and wrong here: a ringed message box reads as a validated field,
 * and no current chat app rings its composer — iMessage and WhatsApp show no
 * focus treatment at all. So the ring is cleared on both platforms and focus is
 * left to the caret and the keyboard, which are what actually tell a reader the
 * composer is live. The `default` appearance keeps heroui's ring, because
 * sign-in really is a form and its fields need a visible focus state of their
 * own.
 */
const CHAT_APPEARANCE = [
  'rounded-full px-4 py-3',
  'ios:focus:outline-transparent android:focus:border-transparent',
].join(' ');

export type ComposerFieldProps = Omit<
  InputProps,
  | 'accessibilityHint'
  | 'accessibilityLabel'
  | 'allowFontScaling'
  | 'editable'
  | 'isDisabled'
  | 'isInvalid'
  | 'maxFontSizeMultiplier'
  | 'multiline'
  | 'onChangeText'
  | 'returnKeyType'
  | 'submitBehavior'
  | 'textAlignVertical'
  | 'value'
> & {
  label: string;
  value: string;
  onChangeText(value: string): void;
  error?: string | null;
  isDisabled?: boolean;
  accessibilityHint?: string;
  hideLabel?: boolean;
  appearance?: 'default' | 'chat';
};

export const ComposerField = forwardRef<TextInputType, ComposerFieldProps>(
  function ComposerField(
    {
      label,
      value,
      onChangeText,
      error,
      isDisabled = false,
      accessibilityHint,
      className,
      hideLabel = false,
      appearance = 'default',
      ...inputProps
    },
    ref
  ) {
    const isInvalid = Boolean(error);
    const textScale = useTextScale();

    return (
      <HeroTextField isDisabled={isDisabled} isInvalid={isInvalid}>
        {hideLabel ? null : (
          <Label>
            <Label.Text key={textScale} style={{ lineHeight: undefined }}>
              {label}
            </Label.Text>
          </Label>
        )}
        <Input
          {...inputProps}
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          isDisabled={isDisabled}
          isInvalid={isInvalid}
          multiline
          textAlignVertical="top"
          returnKeyType="default"
          submitBehavior="newline"
          allowFontScaling
          maxFontSizeMultiplier={textScaleMeasurementMultiplier(textScale)}
          accessibilityLabel={label}
          accessibilityHint={error ?? accessibilityHint}
          accessibilityState={{ disabled: isDisabled }}
          variant={appearance === 'chat' ? 'secondary' : inputProps.variant}
          className={`max-h-36 min-h-12 text-base ${
            appearance === 'chat' ? CHAT_APPEARANCE : 'py-2'
          } ${className ?? ''}`.trim()}
          style={[inputProps.style, { lineHeight: undefined }]}
        />
        {error ? (
          <FieldError
            key={textScale}
            styles={{ text: { lineHeight: undefined } }}
          >
            {error}
          </FieldError>
        ) : null}
      </HeroTextField>
    );
  }
);
