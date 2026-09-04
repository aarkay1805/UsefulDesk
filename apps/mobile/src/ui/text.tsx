import type { ComponentProps } from 'react';
import { Text as NativeText } from 'react-native';

import { useTextScale } from './use-text-scale';

type TextProps = ComponentProps<typeof NativeText>;

/**
 * The UsefulDesk text master. Use this everywhere instead of `Text` from
 * `react-native`.
 *
 * It does two things every screen needs:
 *
 * 1. Re-measures when the OS text scale changes. React Native builds a
 *    paragraph's measured content once and memoises it on the shadow node
 *    (`ParagraphShadowNode::getContent` returns the cached `content_` without
 *    consulting the `LayoutContext` it is handed), so the `fontSizeMultiplier`
 *    iOS pushes on a Dynamic Type change never reaches Yoga. The glyphs still
 *    repaint at the new size, so text keeps its launch-time frame and is
 *    sliced off at the top and bottom. Only new props rebuild that cache, and
 *    with React Compiler on, re-rendering an ancestor is not enough — the
 *    memoised JSX hands the node the identical props. Keying on the scale
 *    remounts the node instead, which is free here: a text leaf holds no
 *    state, and every ancestor keeps its scroll position and its own state.
 *
 * 2. Drops the line height that uniwind resolves from Tailwind's text-size
 *    classes. `text-base` carries `line-height: 1.5`, which uniwind multiplies
 *    by the *unscaled* font size into a fixed 24px and pins as the line box.
 *    Clearing it lets the font's own metrics set the line box, so leading
 *    tracks the glyphs at every content size.
 */
export function Text({ style, ...props }: TextProps) {
  const textScale = useTextScale();

  return (
    <NativeText
      {...props}
      key={textScale}
      style={[style, { lineHeight: undefined }]}
    />
  );
}
