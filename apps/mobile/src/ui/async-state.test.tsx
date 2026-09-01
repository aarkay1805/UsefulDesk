import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorState } from './async-state';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockAlert(props: import('react-native').ViewProps) {
    return React.createElement(View, {
      ...props,
      accessible: true,
      accessibilityRole: 'alert',
    });
  }

  function MockAlertIndicator() {
    return null;
  }

  function MockAlertContent({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(View, null, children);
  }

  function MockAlertTitle({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(Text, null, children);
  }

  function MockAlertDescription({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(Text, null, children);
  }

  MockAlert.Indicator = MockAlertIndicator;
  MockAlert.Content = MockAlertContent;
  MockAlert.Title = MockAlertTitle;
  MockAlert.Description = MockAlertDescription;

  function MockButton(props: import('react-native').PressableProps) {
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
    });
  }

  function MockButtonLabel({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(Text, null, children);
  }

  MockButton.Label = MockButtonLabel;

  function MockSpinner() {
    return null;
  }

  return { Alert: MockAlert, Button: MockButton, Spinner: MockSpinner };
});

it('exposes recoverable errors as alerts with one retry', () => {
  const retry = jest.fn();
  render(
    <ErrorState
      title="Could not load conversations"
      message="Check your connection and try again."
      onRetry={retry}
    />
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
