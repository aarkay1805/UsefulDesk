import { render, screen, within } from '@testing-library/react-native';
import { Pressable, Text as NativeText } from 'react-native';

import { Notice } from './notice';

function action(label: string) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button">
      <NativeText>{label}</NativeText>
    </Pressable>
  );
}

describe('Notice', () => {
  it('announces the copy and leaves the action outside the alert', () => {
    render(
      <Notice action={action('Check again')} title="Live updates unavailable">
        Pull to refresh while the connection recovers.
      </Notice>
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Live updates unavailable')).toBeTruthy();
    expect(
      within(alert).getByText('Pull to refresh while the connection recovers.')
    ).toBeTruthy();
    /*
     * The regression this master exists to prevent: the bar it replaced never
     * announced at all, and an action swallowed into the alert region is read
     * out as part of the message instead of reached as a control.
     */
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('renders a reason with no title', () => {
    render(<Notice testID="notice">Checking template send safety…</Notice>);

    expect(screen.getByText('Checking template send safety…')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it.each([
    ['fill', 'warning', 'bg-warning-soft'],
    ['fill', 'danger', 'bg-danger-soft'],
    ['outline', 'warning', 'border-warning/30'],
    ['outline', 'danger', 'border-danger/30'],
  ] as const)(
    'paints the %s %s surface from its own tokens',
    (emphasis, tone, expected) => {
      render(
        <Notice emphasis={emphasis} testID="notice" tone={tone}>
          Something happened.
        </Notice>
      );

      expect(screen.getByTestId('notice').props.className).toContain(expected);
    }
  );

  it('keeps a filled notice legible on its own tint and an outlined one on the page', () => {
    const { rerender } = render(
      <Notice testID="notice" title="Could not send" tone="danger">
        The send request did not complete.
      </Notice>
    );

    expect(
      screen.getByText('Could not send').props.className
    ).toContain('text-danger-soft-foreground');

    rerender(
      <Notice emphasis="outline" testID="notice" title="Could not send" tone="danger">
        The send request did not complete.
      </Notice>
    );

    expect(screen.getByText('Could not send').props.className).toContain(
      'text-foreground'
    );
    expect(
      screen.getByText('The send request did not complete.').props.className
    ).toContain('text-muted');
  });

  it('hides the loading spinner from the screen reader that already hears the reason', () => {
    render(
      <Notice loading testID="notice">
        Checking template send safety…
      </Notice>
    );

    const spinner = screen
      .getByTestId('notice')
      .findByProps({ accessibilityElementsHidden: true });

    expect(spinner.props.importantForAccessibility).toBe('no');
  });

  it('tints the mark for the ground it sits on, not for the tone alone', () => {
    const spinnerColor = () =>
      screen.getByTestId('notice').findByProps({
        accessibilityElementsHidden: true,
      }).props.color;

    /*
     * A filled notice carries the soft foreground, which is the token built to
     * stay legible on that tint. Only an outlined one, sitting on the page
     * surface, can afford the solid tone.
     */
    const { rerender } = render(
      <Notice loading testID="notice">
        Checking…
      </Notice>
    );
    expect(spinnerColor()).toBe('#7a3e00');

    rerender(
      <Notice emphasis="outline" loading testID="notice">
        Checking…
      </Notice>
    );
    expect(spinnerColor()).toBe('#8a4b00');

    rerender(
      <Notice loading testID="notice" tone="danger">
        Checking…
      </Notice>
    );
    expect(spinnerColor()).toBe('#991b1b');
  });

  it('takes external layout through className without losing its surface', () => {
    render(
      <Notice className="mx-4 mt-3" testID="notice">
        Pull to refresh while the connection recovers.
      </Notice>
    );

    const className = screen.getByTestId('notice').props.className;
    expect(className).toContain('mx-4 mt-3');
    expect(className).toContain('bg-warning-soft');
    expect(className).toContain('rounded-2xl');
  });
});
