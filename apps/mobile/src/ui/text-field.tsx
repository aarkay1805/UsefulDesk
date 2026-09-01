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

export function TextField({ label, error, ...inputProps }: TextFieldProps) {
  return (
    <HeroTextField isInvalid={Boolean(error)}>
      <Label>{label}</Label>
      <Input {...inputProps} />
      {error ? <FieldError>{error}</FieldError> : null}
    </HeroTextField>
  );
}
