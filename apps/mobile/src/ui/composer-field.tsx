import { forwardRef } from 'react';
import type { TextInput as TextInputType } from 'react-native';
import {
  FieldError,
  Input,
  Label,
  TextField as HeroTextField,
  type InputProps,
} from 'heroui-native';

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

    return (
      <HeroTextField isDisabled={isDisabled} isInvalid={isInvalid}>
        {hideLabel ? null : (
          <Label>
            <Label.Text style={{ lineHeight: undefined }}>{label}</Label.Text>
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
          accessibilityLabel={label}
          accessibilityHint={error ?? accessibilityHint}
          accessibilityState={{ disabled: isDisabled }}
          variant={appearance === 'chat' ? 'secondary' : inputProps.variant}
          className={`max-h-36 min-h-12 text-base ${
            appearance === 'chat' ? 'rounded-full px-4 py-3' : 'py-2'
          } ${className ?? ''}`.trim()}
          style={[inputProps.style, { lineHeight: undefined }]}
        />
        {error ? (
          <FieldError styles={{ text: { lineHeight: undefined } }}>
            {error}
          </FieldError>
        ) : null}
      </HeroTextField>
    );
  }
);
