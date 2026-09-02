import { fireEvent, render, screen } from '@testing-library/react-native';

import { FilterChipGroup } from './filter-chip-group';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockChip(props: import('react-native').PressableProps) {
    return React.createElement(Pressable, props);
  }

  function MockChipLabel({
    children,
    style,
  }: {
    children?: import('react').ReactNode;
    style?: import('react-native').TextStyle;
  }) {
    return React.createElement(Text, { style }, children);
  }

  MockChip.Label = MockChipLabel;

  return { Chip: MockChip };
});

it('announces one selected filter and its unread count', () => {
  const onValueChange = jest.fn();
  render(
    <FilterChipGroup
      accessibilityLabel="Conversation filters"
      options={[
        { label: 'All', value: 'all' },
        { label: 'Unread', value: 'unread', count: 3 },
      ]}
      value="all"
      onValueChange={onValueChange}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Unread, 3' }));
  expect(onValueChange).toHaveBeenCalledWith('unread');
});

it('keeps short filter labels inside a 48dp minimum-width target', () => {
  render(
    <FilterChipGroup
      accessibilityLabel="Conversation filters"
      options={[{ label: 'All', value: 'all' }]}
      value="all"
      onValueChange={jest.fn()}
    />
  );

  expect(screen.getByRole('button', { name: 'All' }).props.className).toContain(
    'min-w-12'
  );
  expect(screen.getByText('All').props.style).toEqual({
    lineHeight: undefined,
  });
});
