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
    className,
    style,
  }: {
    children?: import('react').ReactNode;
    className?: string;
    style?: import('react-native').TextStyle;
  }) {
    return React.createElement(Text, { className, style }, children);
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
  it('applies an optional label class without forwarding it to the button root', () => {
    render(
      <Button
        labelClassName="text-zinc-950"
        testID="account-button"
        variant="ghost"
      >
        Account
      </Button>
    );

    expect(screen.getByText('Account').props.className).toBe('text-zinc-950');
    expect(screen.getByTestId('account-button').props.labelClassName).toBe(
      undefined
    );
    expect(screen.getByText('Account').props.style).toEqual({
      lineHeight: undefined,
    });
  });

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

  it.each([
    ['sm', 'min-h-12', 'py-2'],
    ['md', 'min-h-12', 'py-3'],
    ['lg', 'min-h-14', 'py-3.5'],
  ] as const)(
    'keeps the %s size content-driven while preserving its minimum geometry',
    (size, minimumHeight, verticalPadding) => {
      render(
        <Button size={size} testID={`${size}-button`}>
          A label that can grow with Dynamic Type
        </Button>
      );

      const className = screen.getByTestId(`${size}-button`).props.className;
      expect(className).toContain('h-auto');
      expect(className).toContain(minimumHeight);
      expect(className).toContain(verticalPadding);
    }
  );
});
