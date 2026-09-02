import { ScrollView } from 'react-native';
import { Chip } from 'heroui-native';

export interface FilterChipOption<T extends string> {
  label: string;
  value: T;
  count?: number;
}

export interface FilterChipGroupProps<T extends string> {
  accessibilityLabel: string;
  options: readonly FilterChipOption<T>[];
  value: T;
  onValueChange(value: T): void;
}

export function FilterChipGroup<T extends string>({
  accessibilityLabel,
  options,
  value,
  onValueChange,
}: FilterChipGroupProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      contentContainerClassName="gap-2"
    >
      {options.map((option) => {
        const selected = option.value === value;
        const label =
          option.count === undefined
            ? option.label
            : `${option.label}, ${option.count}`;

        return (
          <Chip
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            variant={selected ? 'primary' : 'tertiary'}
            onPress={() => onValueChange(option.value)}
            className="min-h-12 min-w-12"
          >
            <Chip.Label style={{ lineHeight: undefined }}>{label}</Chip.Label>
          </Chip>
        );
      })}
    </ScrollView>
  );
}
