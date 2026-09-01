import { HERO_UI_CONFIG } from './mobile-app-providers';

jest.mock('heroui-native', () => ({
  HeroUINativeProvider: ({ children }: import('react').PropsWithChildren) =>
    children,
}));

describe('HERO_UI_CONFIG', () => {
  it('keeps text scalable within the UsefulDesk accessibility ceiling', () => {
    expect(HERO_UI_CONFIG.textProps).toMatchObject({
      allowFontScaling: true,
      maxFontSizeMultiplier: 1.5,
    });
    expect(HERO_UI_CONFIG.textInputProps).toMatchObject({
      allowFontScaling: true,
      maxFontSizeMultiplier: 1.5,
    });
  });

  it('limits the visible toast queue to three messages', () => {
    expect(HERO_UI_CONFIG.toast).toMatchObject({
      maxVisibleToasts: 3,
    });
  });
});
