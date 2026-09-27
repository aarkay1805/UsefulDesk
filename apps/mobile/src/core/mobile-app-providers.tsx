import type { PropsWithChildren } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeroUINativeProvider, type HeroUINativeConfig } from 'heroui-native';
import { useCSSVariable, useUniwind } from 'uniwind';

export const HERO_UI_CONFIG: HeroUINativeConfig = {
  textProps: { allowFontScaling: true },
  textInputProps: { allowFontScaling: true },
  isRTL: I18nManager.isRTL,
  toast: {
    defaultProps: { placement: 'top', variant: 'default' },
    maxVisibleToasts: 3,
  },
};

function NativeNavigationTheme({ children }: PropsWithChildren) {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const systemColorScheme = useColorScheme();
  const [background, foreground, border, accent] = useCSSVariable([
    '--color-background',
    '--color-foreground',
    '--color-border',
    '--color-accent',
  ]);
  const isDark = hasAdaptiveThemes
    ? systemColorScheme === 'dark'
    : theme === 'dark';
  const base = isDark ? DarkTheme : DefaultTheme;
  const colors = {
    ...base.colors,
    background:
      typeof background === 'string' ? background : base.colors.background,
    card: typeof background === 'string' ? background : base.colors.card,
    text: typeof foreground === 'string' ? foreground : base.colors.text,
    border: typeof border === 'string' ? border : base.colors.border,
    primary: typeof accent === 'string' ? accent : base.colors.primary,
  };

  return (
    <ThemeProvider value={{ ...base, colors }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {children}
    </ThemeProvider>
  );
}

export function MobileAppProviders({ children }: PropsWithChildren) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider config={HERO_UI_CONFIG}>
          <NativeNavigationTheme>{children}</NativeNavigationTheme>
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
