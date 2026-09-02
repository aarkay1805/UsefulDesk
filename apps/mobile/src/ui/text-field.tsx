import {
  FieldError,
  Input,
  Label,
  TextField as HeroTextField,
  type InputProps,
} from 'heroui-native';

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
  return (
    <HeroTextField isInvalid={Boolean(error)}>
      <Label>
        <Label.Text style={{ lineHeight: undefined }}>{label}</Label.Text>
      </Label>
      <Input
        {...inputProps}
        className={`min-h-12 ${className ?? ''}`.trim()}
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
