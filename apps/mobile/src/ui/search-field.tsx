import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { SearchField as HeroSearchField } from 'heroui-native';

import { textScaleMeasurementMultiplier, useTextScale } from './use-text-scale';

/**
 * The trailing lane the field's own stylesheet reserves for the clear button
 * (`.search-field__input--with-clear-button`), and the inset it anchors that
 * button at (`.search-field__clear-button`).
 *
 * A trailing accessory has to be measured against both. The field's pill —
 * background, border, focus ring — belongs to the *input*, not to the row that
 * wraps it, so an in-flow sibling would sit outside the pill rather than in
 * it. The accessory is therefore absolutely positioned over the input's
 * trailing edge, exactly as the clear button already is, and its measured
 * width then pushes the clear button inward and reserves the query's padding.
 */
const CLEAR_BUTTON_LANE = 48;
const CLEAR_BUTTON_INSET = 12;

export interface SearchFieldProps {
  accessibilityLabel: string;
  value: string;
  onValueChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * A control pinned inside the field on its trailing edge, after the clear
   * button — a filter dropdown, say. It lays out in flow, so it may be any
   * width and may grow with the OS text scale.
   */
  trailingAccessory?: ReactNode;
}

export function SearchField({
  accessibilityLabel,
  value,
  onValueChange,
  placeholder = 'Search',
  disabled = false,
  trailingAccessory,
}: SearchFieldProps) {
  const textScale = useTextScale();
  const [accessoryWidth, setAccessoryWidth] = useState(0);

  const onAccessoryLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setAccessoryWidth((current) => (current === next ? current : next));
  };

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
          maxFontSizeMultiplier={textScaleMeasurementMultiplier(textScale)}
          returnKeyType="search"
          style={{
            lineHeight: undefined,
            paddingInlineEnd: accessoryWidth
              ? accessoryWidth + CLEAR_BUTTON_LANE
              : undefined,
          }}
        />
        <HeroSearchField.ClearButton
          accessibilityLabel="Clear search"
          isDisabled={disabled}
          className="min-h-12 min-w-12"
          style={
            accessoryWidth
              ? { insetInlineEnd: accessoryWidth + CLEAR_BUTTON_INSET }
              : undefined
          }
        />
        {trailingAccessory ? (
          <View
            className="absolute inset-y-0 end-1 flex-row items-center"
            onLayout={onAccessoryLayout}
            testID="search-field-trailing-accessory"
          >
            {/*
             * The seam between the query and the accessory. Without it a
             * worded trigger reads as stray text typed into the field.
             */}
            <View className="bg-border mr-1 h-5 w-px" />
            {trailingAccessory}
          </View>
        ) : null}
      </HeroSearchField.Group>
    </HeroSearchField>
  );
}
