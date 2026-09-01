import { SearchField as HeroSearchField } from 'heroui-native';

export interface SearchFieldProps {
  accessibilityLabel: string;
  value: string;
  onValueChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchField({
  accessibilityLabel,
  value,
  onValueChange,
  placeholder = 'Search',
  disabled = false,
}: SearchFieldProps) {
  return (
    <HeroSearchField
      value={value}
      onChange={onValueChange}
      isDisabled={disabled}
      className="min-h-12"
    >
      <HeroSearchField.Group className="min-h-12">
        <HeroSearchField.SearchIcon />
        <HeroSearchField.Input
          accessibilityLabel={accessibilityLabel}
          placeholder={placeholder}
          returnKeyType="search"
        />
        <HeroSearchField.ClearButton
          accessibilityLabel="Clear search"
          isDisabled={disabled}
          className="min-h-12 min-w-12"
        />
      </HeroSearchField.Group>
    </HeroSearchField>
  );
}
