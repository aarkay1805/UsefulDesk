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
      ...inputProps
    },
    ref
  ) {
    const isInvalid = Boolean(error);

    return (
      <HeroTextField isDisabled={isDisabled} isInvalid={isInvalid}>
        <Label>{label}</Label>
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
          maxFontSizeMultiplier={1.5}
          accessibilityLabel={label}
          accessibilityHint={error ?? accessibilityHint}
          accessibilityState={{ disabled: isDisabled }}
          className={`max-h-36 min-h-11 py-2 text-base ${className ?? ''}`.trim()}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </HeroTextField>
    );
  }
);
