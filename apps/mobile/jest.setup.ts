import 'react-native-gesture-handler/jestSetup';

jest.mock('uniwind', () => {
  const actual = jest.requireActual('uniwind');
  const colors: Record<string, string> = {
    '--color-foreground': '#18181b',
    '--color-accent-foreground': '#fcfcfc',
  };

  return {
    ...actual,
    useCSSVariable: (name: string | string[]) => {
      if (Array.isArray(name) && name.every((item) => colors[item])) {
        return name.map((item) => colors[item]);
      }
      if (typeof name === 'string' && colors[name]) return colors[name];
      return actual.useCSSVariable(name);
    },
  };
});

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000';
process.env.EXPO_PUBLIC_APP_ENV = 'test';
