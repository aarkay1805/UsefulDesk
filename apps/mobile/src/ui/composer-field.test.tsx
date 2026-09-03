import { createRef, useState } from 'react';
import type { TextInput as TextInputType } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ComposerField } from './composer-field';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Text, TextInput, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockTextField({
    children,
    isDisabled,
    isInvalid,
  }: {
    children?: import('react').ReactNode;
    isDisabled?: boolean;
    isInvalid?: boolean;
  }) {
    return React.createElement(
      View,
      {
        accessibilityState: { disabled: isDisabled },
        accessibilityValue: { text: isInvalid ? 'invalid' : 'valid' },
      },
      children
    );
  }

  function MockLabel({ children }: { children?: import('react').ReactNode }) {
    return React.createElement(View, null, children);
  }
  MockLabel.Text = function MockLabelText({
    children,
    style,
  }: {
    children?: import('react').ReactNode;
    style?: import('react-native').TextStyle;
  }) {
    return React.createElement(Text, { style }, children);
  };

  function MockFieldError({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(Text, { accessibilityRole: 'alert' }, children);
  }

  const MockInput = React.forwardRef(function MockInput(
    { isDisabled, onChangeText, ...props }: any,
    ref: any
  ) {
    return React.createElement(TextInput, {
      ...props,
      ref,
      editable: !isDisabled && props.editable,
      onChangeText: isDisabled ? undefined : onChangeText,
    });
  });

  return {
    FieldError: MockFieldError,
    Input: MockInput,
    Label: MockLabel,
    TextField: MockTextField,
  };
});

describe('ComposerField', () => {
  it('edits a controlled multiline value and preserves Return for new lines', () => {
    function ControlledComposer() {
      const [value, setValue] = useState('');
      return (
        <ComposerField
          label="Message"
          value={value}
          onChangeText={setValue}
          placeholder="Write a message"
        />
      );
    }

    render(<ControlledComposer />);

    const input = screen.getByLabelText('Message');
    fireEvent.changeText(input, 'First line\nSecond line');

    expect(input.props.value).toBe('First line\nSecond line');
    expect(input.props.multiline).toBe(true);
    expect(input.props.returnKeyType).toBe('default');
    expect(input.props.submitBehavior).toBe('newline');
  });

  it('forwards the native input focus ref and honours Dynamic Type settings', () => {
    const ref = createRef<TextInputType>();

    render(
      <ComposerField
        ref={ref}
        label="Message"
        value="Hello"
        onChangeText={jest.fn()}
      />
    );

    const input = screen.getByLabelText('Message');
    expect(ref.current?.focus).toEqual(expect.any(Function));
    expect(() => ref.current?.focus()).not.toThrow();
    expect(input.props.allowFontScaling).toBe(true);
    expect(input.props.maxFontSizeMultiplier).toBeUndefined();
    expect(input.props.className).toContain('min-h-12');
    expect(input.props.className).toContain('max-h-36');
  });

  it('can hide the visual label while keeping the input accessibility name', () => {
    render(
      <ComposerField
        hideLabel
        label="Message"
        value=""
        onChangeText={jest.fn()}
      />
    );

    expect(screen.queryByText('Message')).toBeNull();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('owns the filled rounded treatment used by the chat composer', () => {
    render(
      <ComposerField
        appearance="chat"
        label="Message"
        value=""
        onChangeText={jest.fn()}
      />
    );

    const input = screen.getByLabelText('Message');
    expect(input.props.variant).toBe('secondary');
    expect(input.props.className).toContain('rounded-full');
    expect(input.props.className).toContain('px-4');
  });

  it('makes an error readable from the field and suppresses disabled editing', () => {
    const onChangeText = jest.fn();
    render(
      <ComposerField
        label="Message"
        value=""
        onChangeText={onChangeText}
        error="Enter a message before sending"
        isDisabled
      />
    );

    const input = screen.getByLabelText('Message');
    expect(input.props.accessibilityHint).toBe(
      'Enter a message before sending'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a message before sending'
    );
    expect(input.props.editable).toBe(false);
    expect(input.props.accessibilityState).toEqual({ disabled: true });

    fireEvent.changeText(input, 'Ignored');
    expect(onChangeText).not.toHaveBeenCalled();
  });
});
