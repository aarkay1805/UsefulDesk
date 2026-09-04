import { Text, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SearchField } from './search-field';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, TextInput, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  let onChange: ((value: string) => void) | undefined;

  function MockSearchField({
    children,
    onChange: nextOnChange,
  }: {
    children?: import('react').ReactNode;
    onChange?: (value: string) => void;
  }) {
    onChange = nextOnChange;
    return React.createElement(View, null, children);
  }

  function MockSearchFieldGroup({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(View, null, children);
  }

  function MockSearchFieldSearchIcon() {
    return null;
  }

  function MockSearchFieldInput(props: import('react-native').TextInputProps) {
    return React.createElement(TextInput, props);
  }

  function MockSearchFieldClearButton({
    isDisabled,
    ...props
  }: import('react-native').PressableProps & { isDisabled?: boolean }) {
    return React.createElement(Pressable, {
      ...props,
      disabled: isDisabled,
      accessibilityState: { disabled: isDisabled },
      accessibilityRole: 'button',
      onPress: () => {
        if (!isDisabled) {
          onChange?.('');
        }
      },
    });
  }

  MockSearchField.Group = MockSearchFieldGroup;
  MockSearchField.SearchIcon = MockSearchFieldSearchIcon;
  MockSearchField.Input = MockSearchFieldInput;
  MockSearchField.ClearButton = MockSearchFieldClearButton;

  return { SearchField: MockSearchField };
});

it('clears a controlled search and returns the empty value', () => {
  const onValueChange = jest.fn();
  render(
    <SearchField
      accessibilityLabel="Search conversations"
      value="Asha"
      onValueChange={onValueChange}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(onValueChange).toHaveBeenCalledWith('');
});

it('disables the clear action with the search field', () => {
  const onValueChange = jest.fn();
  render(
    <SearchField
      accessibilityLabel="Search conversations"
      value="Asha"
      onValueChange={onValueChange}
      disabled
    />
  );

  const clearButton = screen.getByRole('button', { name: 'Clear search' });
  expect(clearButton.props.accessibilityState).toEqual({ disabled: true });
  fireEvent.press(clearButton);
  expect(onValueChange).not.toHaveBeenCalled();
});

it('keeps a trailing accessory clear of the clear button and the query text', () => {
  render(
    <SearchField
      accessibilityLabel="Search conversations"
      value="Asha"
      onValueChange={jest.fn()}
      trailingAccessory={
        <View>
          <Text>All</Text>
        </View>
      }
    />
  );

  expect(screen.getByText('All')).toBeTruthy();

  // Nothing is measured before layout, so neither control is displaced yet.
  expect(
    screen.getByRole('button', { name: 'Clear search' }).props.style
  ).toBeUndefined();

  fireEvent(screen.getByTestId('search-field-trailing-accessory'), 'layout', {
    nativeEvent: { layout: { width: 96, height: 48, x: 0, y: 0 } },
  });

  // The clear button clears the accessory and keeps its own 12pt inset, and
  // the query stops short of both lanes rather than sliding under them.
  expect(
    screen.getByRole('button', { name: 'Clear search' }).props.style
  ).toEqual({ insetInlineEnd: 108 });
  expect(screen.getByLabelText('Search conversations').props.style).toEqual({
    lineHeight: undefined,
    paddingInlineEnd: 144,
  });
});

it('reserves no accessory lane when the field carries no accessory', () => {
  render(
    <SearchField
      accessibilityLabel="Search conversations"
      value="Asha"
      onValueChange={jest.fn()}
    />
  );

  expect(screen.queryByTestId('search-field-trailing-accessory')).toBeNull();
  expect(screen.getByLabelText('Search conversations').props.style).toEqual({
    lineHeight: undefined,
    paddingInlineEnd: undefined,
  });
});
