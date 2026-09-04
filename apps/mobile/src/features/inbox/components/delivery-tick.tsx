import { PlatformColor, View, type ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

import { useTextScale } from '../../../ui/use-text-scale';

import type { MessageStatus } from '../inbox-types';

/**
 * The delivery state on an outbound bubble, drawn.
 *
 * These were Unicode text before: `✓`, `✓✓`, `◷`. Two check CHARACTERS set
 * side by side are not WhatsApp's overlapped double tick — they read as a
 * typo — and `◷` is a geometric-shapes glyph most Android system fonts do
 * not carry, so "sending" could arrive as a tofu box. Drawing them fixes
 * both, and lets sent / delivered / read share one stroke weight and cap
 * geometry so the three states differ only where they mean to.
 *
 * `read` is the one state that changes hue. WhatsApp's blue double tick is
 * the most recognised delivery signal in messaging, and it is a fixed
 * domain status — so it resolves through `--color-chat-read` and must NOT
 * follow the account accent, or "read" and "brand" become the same colour.
 */

const STROKE = 1.7;
const HEIGHT = 11;
/**
 * The mark grows with the reader's type size, because the glyph it replaced
 * was text and did. Left at a fixed 11pt it shrinks into a speck beside a
 * timestamp at Accessibility XL. Capped at 2× so an already-wrapped bubble
 * does not have to find room for a mark bigger than the words.
 */
const MAX_SCALE = 2;

export interface DeliveryTickProps {
  status: MessageStatus;
  /** Picks the meta tone derived from the bubble fill this sits on. */
  isOutbound: boolean;
}

export function DeliveryTick({ status, isOutbound }: DeliveryTickProps) {
  const fontScale = useTextScale();
  const [meta, metaOut, read] = useCSSVariable([
    '--color-chat-meta',
    '--color-chat-meta-out',
    '--color-chat-read',
  ]);

  if (status === 'failed') return null;

  const scale = Math.min(Math.max(fontScale, 1), MAX_SCALE);

  const tone = isOutbound ? metaOut : meta;
  const resolved: ColorValue =
    status === 'read'
      ? ((read as ColorValue) ?? PlatformColor('label'))
      : ((tone as ColorValue) ?? PlatformColor('label'));

  // A single tick is narrower than a double one. Reserving the double
  // width for both would leave "sent" floating away from the timestamp.
  // 11 rather than 10 for the single: the back tick reaches x=9.3 and its
  // round cap adds half a stroke on top, which a 10pt box would clip.
  const box = status === 'delivered' || status === 'read' ? 15 : 11;
  // The viewBox keeps the drawing's own coordinates; only the rendered
  // size scales, so stroke weight grows with the mark instead of thinning.
  const width = box * scale;
  const height = HEIGHT * scale;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // The bubble meta is 12px type; the glyph rides its baseline rather
      // than its box, so it sits a hair low on purpose.
      style={{ height, width, transform: [{ translateY: scale }] }}
      testID={`delivery-tick-${status}`}
    >
      <Svg
        fill="none"
        height={height}
        viewBox={`0 0 ${box} ${HEIGHT}`}
        width={width}
      >
        {status === 'sending' ? (
          <>
            <Circle
              cx={5.5}
              cy={5.5}
              r={4.4}
              stroke={resolved}
              strokeWidth={STROKE * 0.85}
            />
            <Path
              d="M5.5 3.1V5.8L7.4 6.9"
              stroke={resolved}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={STROKE * 0.85}
            />
          </>
        ) : (
          <>
            <Path
              // The back tick. On a double it is clipped by the front one
              // riding over it, which is exactly what makes the pair read
              // as one mark instead of two checkmarks in a row.
              d="M1 6.1L3.9 9.2L9.3 2.4"
              stroke={resolved}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={STROKE}
            />
            {status !== 'sent' ? (
              <Path
                d="M5.7 6.1L8.6 9.2L14 2.4"
                stroke={resolved}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={STROKE}
              />
            ) : null}
          </>
        )}
      </Svg>
    </View>
  );
}
