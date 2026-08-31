import type { PropsWithChildren } from 'react';
import { I18nManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { HeroUINativeProvider, type HeroUINativeConfig } from 'heroui-native';

export const HERO_UI_CONFIG: HeroUINativeConfig = {
  textProps: { allowFontScaling: true, maxFontSizeMultiplier: 1.5 },
  textInputProps: { allowFontScaling: true, maxFontSizeMultiplier: 1.5 },
  isRTL: I18nManager.isRTL,
  toast: {
    defaultProps: { placement: 'top', variant: 'default' },
    maxVisibleToasts: 3,
  },
};

export function MobileAppProviders({ children }: PropsWithChildren) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={HERO_UI_CONFIG}>
        {children}
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
