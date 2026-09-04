import { fireEvent, render, screen } from '@testing-library/react-native';

import { FilterMenu } from './filter-menu';

jest.mock('expo-symbols', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockSymbolView(props: { name: unknown; size?: number }) {
    return React.createElement(View, { ...props, testID: 'symbol' });
  }

  return { SymbolView: MockSymbolView };
});

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  const OpenContext = React.createContext({
    isOpen: false,
    setOpen: (_next: boolean): void => undefined,
  });

  let selectionHandler: ((keys: Set<string>) => void) | undefined;

  function MockMenu({ children }: import('react').PropsWithChildren) {
    const [isOpen, setOpen] = React.useState(false);
    return React.createElement(
      OpenContext.Provider,
      { value: { isOpen, setOpen } },
      children
    );
  }

  MockMenu.Trigger = function MockMenuTrigger({
    isDisabled,
    ...props
  }: import('react-native').PressableProps & { isDisabled?: boolean }) {
    const { isOpen, setOpen } = React.useContext(OpenContext);
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
      disabled: isDisabled,
      onPress: () => setOpen(!isOpen),
    });
  };

  MockMenu.Portal = function MockMenuPortal({
    children,
  }: import('react').PropsWithChildren) {
    const { isOpen } = React.useContext(OpenContext);
    return isOpen ? React.createElement(View, null, children) : null;
  };

  MockMenu.Overlay = function MockMenuOverlay() {
    return null;
  };

  MockMenu.Content = function MockMenuContent({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  };

  MockMenu.Group = function MockMenuGroup({
    children,
    onSelectionChange,
  }: import('react').PropsWithChildren<{
    onSelectionChange?: (keys: Set<string>) => void;
  }>) {
    selectionHandler = onSelectionChange;
    return React.createElement(View, null, children);
  };

  MockMenu.Item = function MockMenuItem({
    id,
    ...props
  }: import('react-native').PressableProps & { id?: string }) {
    const { setOpen } = React.useContext(OpenContext);
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
      onPress: () => {
        if (id !== undefined) selectionHandler?.(new Set([id]));
        setOpen(false);
      },
    });
  };

  MockMenu.ItemIndicator = function MockMenuItemIndicator() {
    return null;
  };

  MockMenu.ItemTitle = function MockMenuItemTitle({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  return { Menu: MockMenu };
});

const OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread', count: '3' },
] as const;

it('reads out the active option and keeps the option set closed until asked', () => {
  render(
    <FilterMenu
      accessibilityLabel="Conversation filter"
      options={OPTIONS}
      value="all"
      onValueChange={jest.fn()}
    />
  );

  expect(
    screen.getByRole('button', { name: 'Conversation filter, All' })
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unread, 3' })).toBeNull();
});

it('selects a different filter from the open menu', () => {
  const onValueChange = jest.fn();
  render(
    <FilterMenu
      accessibilityLabel="Conversation filter"
      options={OPTIONS}
      value="all"
      onValueChange={onValueChange}
    />
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Conversation filter, All' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Unread, 3' }));

  expect(onValueChange).toHaveBeenCalledWith('unread');
});

it('does not re-fire for the option already in force', () => {
  const onValueChange = jest.fn();
  render(
    <FilterMenu
      accessibilityLabel="Conversation filter"
      options={OPTIONS}
      value="unread"
      onValueChange={onValueChange}
    />
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Conversation filter, Unread' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Unread, 3' }));

  expect(onValueChange).not.toHaveBeenCalled();
});

it('shows a count as its own text rather than folding it into the label', () => {
  render(
    <FilterMenu
      accessibilityLabel="Conversation filter"
      options={OPTIONS}
      value="all"
      onValueChange={jest.fn()}
    />
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Conversation filter, All' })
  );

  expect(screen.getByText('Unread')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.queryByText('Unread, 3')).toBeNull();
});
