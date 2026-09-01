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

  MockSearchField.Group = ({
    children,
  }: {
    children?: import('react').ReactNode;
  }) => React.createElement(View, null, children);
  MockSearchField.SearchIcon = () => null;
  MockSearchField.Input = (props: import('react-native').TextInputProps) =>
    React.createElement(TextInput, props);
  MockSearchField.ClearButton = (
    props: import('react-native').PressableProps
  ) =>
    React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
      onPress: () => onChange?.(''),
    });

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
