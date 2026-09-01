import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react-native';

import { Button } from './button';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockButton(props: import('react-native').PressableProps) {
    return React.createElement(Pressable, props);
  }

  MockButton.Label = function MockButtonLabel({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(Text, null, children);
  };

  return { Button: MockButton };
});

type UsefulDeskButtonProps = ComponentProps<typeof Button>;

const scaleFeedbackProps = {
  children: 'Save',
  feedbackVariant: 'scale',
  animation: { scale: { value: 0.98 } },
} satisfies UsefulDeskButtonProps;

// @ts-expect-error Feedback-free buttons only accept the disable-all sentinel.
const invalidNoFeedbackAnimation: UsefulDeskButtonProps = {
  children: 'Save',
  feedbackVariant: 'none',
  animation: { scale: { value: 0.98 } },
};

void scaleFeedbackProps;
void invalidNoFeedbackAnimation;

describe('Button', () => {
  it('announces loading, prevents repeat activation, and replaces its label', () => {
    render(
      <Button testID="save-button" loading>
        Save
      </Button>
    );

    expect(screen.getByTestId('save-button').props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.getByLabelText('Working')).toBeTruthy();
  });
});
