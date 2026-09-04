import { useMemo } from 'react';
import { Menu } from 'heroui-native';

import { Glyph } from './glyph';
import { Text } from './text';

export interface FilterMenuOption<T extends string> {
  label: string;
  value: T;
  /**
   * A trailing counter for the option, already formatted by the caller's
   * account locale. This master takes a string rather than a number so the
   * locale layer stays at the call site and never has to be reached for from
   * inside `src/ui`.
   */
  count?: string;
}

export interface FilterMenuProps<T extends string> {
  accessibilityLabel: string;
  options: readonly FilterMenuOption<T>[];
  value: T;
  onValueChange(value: T): void;
  disabled?: boolean;
}

/**
 * A single-choice filter as a dropdown: a compact trigger that reads out the
 * active option, and a popover holding the whole set.
 *
 * The trigger is sized for the trailing slot of `SearchField`, where it sits
 * as an in-flow row item, so it stays as tall as the field (48dp) and no wider
 * than its own label needs.
 *
 * The count is visible text *and* part of the row's accessible name, unlike
 * the filter chips this replaced, which rendered their screen-reader string
 * ("Unread, 3") on screen.
 */
export function FilterMenu<T extends string>({
  accessibilityLabel,
  options,
  value,
  onValueChange,
  disabled = false,
}: FilterMenuProps<T>) {
  const active = options.find((option) => option.value === value) ?? options[0];
  const selectedKeys = useMemo(() => new Set<string>([value]), [value]);

  if (!active) {
    return null;
  }

  return (
    <Menu>
      <Menu.Trigger
        accessibilityLabel={`${accessibilityLabel}, ${active.label}`}
        accessibilityState={{ disabled }}
        className="min-h-12 flex-row items-center gap-1 rounded-full pr-3 pl-2"
        isDisabled={disabled}
      >
        <Text className="text-foreground text-sm font-medium">
          {active.label}
        </Text>
        <Glyph name="chevron.down" size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay />
        <Menu.Content align="end" offset={8} presentation="popover" width={220}>
          <Menu.Group
            /*
             * A filter always has a value, so pressing the active option must
             * close the menu without clearing the selection. Without this the
             * group hands back an empty set and the list would have no scope.
             */
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const [next] = keys;
              if (typeof next === 'string' && next !== value) {
                onValueChange(next as T);
              }
            }}
            selectedKeys={selectedKeys}
            selectionMode="single"
          >
            {options.map((option) => (
              <Menu.Item
                accessibilityLabel={
                  option.count === undefined
                    ? option.label
                    : `${option.label}, ${option.count}`
                }
                className="min-h-12"
                id={option.value}
                key={option.value}
              >
                <Menu.ItemIndicator />
                <Menu.ItemTitle className="flex-1">
                  {option.label}
                </Menu.ItemTitle>
                {option.count === undefined ? null : (
                  <Text className="text-muted text-sm tabular-nums">
                    {option.count}
                  </Text>
                )}
              </Menu.Item>
            ))}
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
