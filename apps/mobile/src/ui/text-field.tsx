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

type TextFieldProps = InputProps & {
  label: string;
  error?: string | null;
};

export function TextField({
  label,
  error,
  className,
  ...inputProps
}: TextFieldProps) {
  const textScale = useTextScale();

  return (
    <HeroTextField isInvalid={Boolean(error)}>
      <Label>
        <Label.Text key={textScale} style={{ lineHeight: undefined }}>
          {label}
        </Label.Text>
      </Label>
      <Input
        {...inputProps}
        className={`min-h-12 ${className ?? ''}`.trim()}
        maxFontSizeMultiplier={textScaleMeasurementMultiplier(
          textScale,
          inputProps.maxFontSizeMultiplier
        )}
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
