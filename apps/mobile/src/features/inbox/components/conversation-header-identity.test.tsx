import { render, screen } from '@testing-library/react-native';

import { ConversationHeaderIdentity } from './conversation-header-identity';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Image, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockAvatar(props: import('react-native').ViewProps) {
    return React.createElement(View, props);
  }
  MockAvatar.Image = function MockAvatarImage(
    props: import('react-native').ImageProps
  ) {
    return React.createElement(Image, props);
  };
  MockAvatar.Fallback = function MockAvatarFallback({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  return { Avatar: MockAvatar };
});

it('keeps a long chat identity readable without branch context', () => {
  const name = 'Asha Rao and Family Membership Enquiry';

  render(
    <ConversationHeaderIdentity
      avatarUrl={null}
      name={name}
      subtitle="+91 98765 43210"
    />
  );

  expect(screen.getByText(name).props.numberOfLines).toBeUndefined();
  expect(
    screen.getByText('+91 98765 43210').props.numberOfLines
  ).toBeUndefined();
  expect(screen.queryByText(/Branch:/)).toBeNull();
  expect(
    screen.getByTestId('conversation-header-identity').props.accessibilityLabel
  ).toBe(`${name}, +91 98765 43210`);
});
