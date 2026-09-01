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

  MockAvatar.Image = (props: import('react-native').ImageProps) =>
    React.createElement(Image, props);
  MockAvatar.Fallback = ({
    children,
  }: {
    children?: import('react').ReactNode;
  }) => React.createElement(Text, null, children);

  return { Avatar: MockAvatar };
});

it('uses a first-initial fallback with an honest avatar label', () => {
  render(<UserAvatar name="Asha Rao" source={null} size="lg" />);
  expect(screen.getByLabelText('Asha Rao')).toBeTruthy();
  expect(screen.getByText('A')).toBeTruthy();
});
