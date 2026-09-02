import { HERO_UI_CONFIG } from './mobile-app-providers';

jest.mock('heroui-native', () => ({
  HeroUINativeProvider: ({ children }: import('react').PropsWithChildren) =>
    children,
}));

describe('HERO_UI_CONFIG', () => {
  it('lets text and fields follow the full system Dynamic Type setting', () => {
    expect(HERO_UI_CONFIG.textProps).toMatchObject({
      allowFontScaling: true,
    });
    expect(HERO_UI_CONFIG.textInputProps).toMatchObject({
      allowFontScaling: true,
    });
    expect(HERO_UI_CONFIG.textProps).not.toHaveProperty(
      'maxFontSizeMultiplier'
    );
    expect(HERO_UI_CONFIG.textInputProps).not.toHaveProperty(
      'maxFontSizeMultiplier'
    );
  });

  it('limits the visible toast queue to three messages', () => {
    expect(HERO_UI_CONFIG.toast).toMatchObject({
      maxVisibleToasts: 3,
    });
  });
});
