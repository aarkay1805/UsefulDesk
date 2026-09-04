import { SymbolView } from 'expo-symbols';
import { PlatformColor, type ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The app's icon vocabulary: an SF Symbol paired with its Material equivalent.
 *
 * Both `Button` and `IconButton` draw from this one map so a glyph cannot mean
 * one thing beside a label and another inside an icon button. Add a symbol here
 * rather than reaching for `SymbolView` at a call site.
 */
export const ANDROID_SYMBOL = {
  'chevron.down': 'expand_more',
  'chevron.left': 'arrow_back',
  doc: 'description',
  paperclip: 'attach_file',
  'person.crop.circle': 'account_circle',
  photo: 'image',
  video: 'videocam',
  waveform: 'graphic_eq',
  xmark: 'close',
} as const;

/**
 * Lucide's `send` (v1.22.0, ISC), drawn rather than imported: `lucide-react`
 * renders DOM SVG, which this app may not import, and the icon is wanted on
 * both platforms so neither SF Symbols' nor Material's plane will do. The path
 * data is copied verbatim from the package in the repository root so the
 * outline stays Lucide's rather than an approximation of it — the same reason
 * `delivery-tick.tsx` draws its ticks.
 */
const LUCIDE_SEND = [
  'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
  'm21.854 2.147-10.94 10.939',
];

export type GlyphName = keyof typeof ANDROID_SYMBOL | 'send';

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  tintColor?: ColorValue;
}

export function Glyph({ name, size = 20, tintColor }: GlyphProps) {
  const resolved = tintColor ?? PlatformColor('label');

  if (name === 'send') {
    return (
      <Svg
        // Lucide draws on a 24 grid at stroke 2. Keeping its viewBox means the
        // stroke scales with the mark instead of thinning as the icon grows.
        fill="none"
        height={size}
        testID="glyph-send"
        viewBox="0 0 24 24"
        width={size}
      >
        {LUCIDE_SEND.map((d) => (
          <Path
            d={d}
            key={d}
            stroke={resolved}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        ))}
      </Svg>
    );
  }

  return (
    <SymbolView
      name={{ ios: name, android: ANDROID_SYMBOL[name] }}
      size={size}
      tintColor={resolved}
      weight="semibold"
    />
  );
}
