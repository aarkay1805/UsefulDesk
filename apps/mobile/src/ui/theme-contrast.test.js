/* global __dirname, describe, expect, it */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const css = readFileSync(join(__dirname, '../../global.css'), 'utf8');

const INHERITED_BACKGROUNDS = {
  light: '#f5f5f5',
  dark: '#060607',
};

function variantToken(appearance, token) {
  const variant = css.match(
    new RegExp(`@variant ${appearance} \\{([\\s\\S]*?)\\n\\s*\\}`)
  )?.[1];
  const value = variant?.match(
    new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`)
  )?.[1];

  if (!value) {
    throw new Error(`Missing ${appearance} --${token} hex token`);
  }

  return value;
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));

  return (lighter + 0.05) / (darker + 0.05);
}

describe.each(['light', 'dark'])('%s semantic theme contrast', (mode) => {
  it('keeps primary button labels at WCAG AA body-text contrast', () => {
    expect(
      contrastRatio(
        variantToken(mode, 'accent'),
        variantToken(mode, 'accent-foreground')
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps danger body copy and danger-soft copy at WCAG AA contrast', () => {
    expect(
      contrastRatio(variantToken(mode, 'danger'), INHERITED_BACKGROUNDS[mode])
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        variantToken(mode, 'danger-soft-foreground'),
        variantToken(mode, 'danger-soft')
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps warning solid and warning-soft copy at WCAG AA contrast', () => {
    expect(
      contrastRatio(
        variantToken(mode, 'warning'),
        variantToken(mode, 'warning-foreground')
      )
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        variantToken(mode, 'warning-soft-foreground'),
        variantToken(mode, 'warning-soft')
      )
    ).toBeGreaterThanOrEqual(4.5);
  });
});
