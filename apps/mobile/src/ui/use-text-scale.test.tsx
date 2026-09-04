import { Dimensions, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { useTextScale } from './use-text-scale';

function Probe() {
  const scale = useTextScale();
  return <Text>{`scale:${scale}`}</Text>;
}

describe('useTextScale', () => {
  it('reports the current OS text scale', () => {
    render(<Probe />);

    expect(
      screen.getByText(`scale:${Dimensions.get('window').fontScale}`)
    ).toBeTruthy();
  });

  it('re-renders the caller when the OS text scale changes', () => {
    // iOS repaints glyphs at the new Dynamic Type size but React Native only
    // rebuilds a paragraph's measurement when React hands its shadow node new
    // props, so a subtree that does not re-render here keeps its old frames
    // and clips its text. This subscription is what forces the re-measure.
    const { window: initialWindow, screen: initialScreen } =
      Dimensions.get('window').fontScale === undefined
        ? { window: undefined, screen: undefined }
        : {
            window: Dimensions.get('window'),
            screen: Dimensions.get('screen'),
          };

    render(<Probe />);

    act(() => {
      Dimensions.set({
        window: { ...initialWindow, fontScale: 2.643 },
        screen: { ...initialScreen, fontScale: 2.643 },
      } as Parameters<typeof Dimensions.set>[0]);
    });

    expect(screen.getByText('scale:2.643')).toBeTruthy();

    act(() => {
      Dimensions.set({
        window: initialWindow,
        screen: initialScreen,
      } as Parameters<typeof Dimensions.set>[0]);
    });
  });

  it('shares one Dimensions subscription across multiple callers', () => {
    const addEventListener = jest.spyOn(Dimensions, 'addEventListener');

    render(
      <>
        <Probe />
        <Probe />
      </>
    );

    expect(addEventListener).toHaveBeenCalledTimes(1);
    addEventListener.mockRestore();
  });
});
