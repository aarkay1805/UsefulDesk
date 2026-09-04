import { render, screen } from '@testing-library/react-native';

import { DeliveryTick } from './delivery-tick';

describe('DeliveryTick', () => {
  it.each(['sending', 'sent', 'delivered', 'read'] as const)(
    'draws the %s state',
    (status) => {
      render(<DeliveryTick isOutbound status={status} />);
      expect(
        screen.getByTestId(`delivery-tick-${status}`, {
          includeHiddenElements: true,
        })
      ).toBeTruthy();
    }
  );

  it('draws nothing for a failed send, which owns its own alert', () => {
    render(<DeliveryTick isOutbound status="failed" />);
    expect(
      screen.queryByTestId('delivery-tick-failed', {
        includeHiddenElements: true,
      })
    ).toBeNull();
  });

  it('stays out of the accessibility tree so the meta label reads once', () => {
    render(<DeliveryTick isOutbound status="read" />);
    const tick = screen.getByTestId('delivery-tick-read', {
      includeHiddenElements: true,
    });
    expect(tick.props.accessibilityElementsHidden).toBe(true);
    expect(tick.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('reserves less width for a single tick than a double one', () => {
    render(<DeliveryTick isOutbound status="sent" />);
    const sent = screen.getByTestId('delivery-tick-sent', {
      includeHiddenElements: true,
    }).props.style;
    screen.unmount();

    render(<DeliveryTick isOutbound status="delivered" />);
    const delivered = screen.getByTestId('delivery-tick-delivered', {
      includeHiddenElements: true,
    }).props.style;

    expect(sent.width).toBeLessThan(delivered.width);
  });
});
