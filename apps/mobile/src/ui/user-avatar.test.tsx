import { render, screen } from '@testing-library/react-native';

import { UserAvatar } from './user-avatar';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Image, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockAvatar(props: import('react-native').ViewProps) {
    return React.createElement(View, props);
  }

  function MockAvatarImage(props: import('react-native').ImageProps) {
    return React.createElement(Image, props);
  }

  function MockAvatarFallback({
    children,
    ...props
  }: {
    children?: import('react').ReactNode;
    classNames?: { text?: string };
  }) {
    return React.createElement(Text, props as never, children);
  }

  MockAvatar.Image = MockAvatarImage;
  MockAvatar.Fallback = MockAvatarFallback;

  return { Avatar: MockAvatar };
});

it('uses a first-initial fallback with an honest avatar label', () => {
  render(<UserAvatar name="Asha Rao" source={null} size="lg" />);
  expect(screen.getByLabelText('Asha Rao')).toBeTruthy();
  expect(screen.getByText('A')).toBeTruthy();
});

it('supports the contrast-safe avatar fallback used by messaging surfaces', () => {
  render(
    <UserAvatar fallbackTone="tinted" name="Asha Rao" source={null} size="md" />
  );

  expect(screen.getByLabelText('Asha Rao').props.className).toBe('bg-avatar');
  expect(screen.getByText('A').props.classNames).toEqual({
    text: 'text-avatar-foreground',
  });
});
