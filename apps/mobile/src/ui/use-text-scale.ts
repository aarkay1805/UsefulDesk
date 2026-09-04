import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';

const subscribers = new Set<() => void>();
let dimensionsSubscription: ReturnType<typeof Dimensions.addEventListener> | null =
  null;

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  dimensionsSubscription ??= Dimensions.addEventListener('change', () => {
    for (const subscriber of subscribers) subscriber();
  });

  return () => {
    subscribers.delete(onStoreChange);
    if (subscribers.size === 0) {
      dimensionsSubscription?.remove();
      dimensionsSubscription = null;
    }
  };
}

function getTextScale() {
  return Dimensions.get('window').fontScale;
}

/**
 * The OS text scale (iOS Dynamic Type, Android font size), re-read whenever it
 * changes.
 *
 * One shared `Dimensions` listener backs every caller, because `Text` calls
 * this per node — `useWindowDimensions` would open a subscription each time.
 * The snapshot is a number, so an orientation change that leaves the scale
 * alone re-renders nobody.
 *
 * See `Text` in `./text.tsx` for why the scale has to reach each text node.
 */
export function useTextScale(): number {
  return useSyncExternalStore(subscribe, getTextScale);
}

/**
 * A changing native text prop that preserves the current effective scale.
 *
 * React Native dirties a text input's cached measurement when this prop
 * changes, while keeping the native input mounted (and therefore preserving
 * focus and selection). Values below 1 mean "uncapped" to React Native; at or
 * above 1 the current system scale is itself the cap, so the rendered result
 * remains identical to unrestricted Dynamic Type.
 */
export function textScaleMeasurementMultiplier(
  textScale: number,
  requestedMaximum?: number | null
): number {
  return requestedMaximum !== undefined &&
    requestedMaximum !== null &&
    requestedMaximum >= 1
    ? Math.min(textScale, requestedMaximum)
    : textScale;
}
