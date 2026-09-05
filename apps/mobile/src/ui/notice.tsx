import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  PlatformColor,
  View,
  type ColorValue,
} from 'react-native';
import { useCSSVariable } from 'uniwind';

import { Glyph, type GlyphName } from './glyph';
import { Text } from './text';

export type NoticeTone = 'warning' | 'danger';
export type NoticeEmphasis = 'fill' | 'outline';

export interface NoticeProps {
  /** The reason. Always rendered, and always part of the announcement. */
  children: ReactNode;
  /**
   * The control that resolves the notice. It lays out under the copy and
   * inside the text column, and stays outside the announced block so a screen
   * reader reaches it as its own node rather than as part of the alert.
   */
  action?: ReactNode;
  /** External layout only — margin, width, alignment. Never fill or radius. */
  className?: string;
  emphasis?: NoticeEmphasis;
  /** Swaps the glyph for a spinner while the notice resolves itself. */
  loading?: boolean;
  symbol?: GlyphName;
  testID?: string;
  title?: string;
  tone?: NoticeTone;
}

/**
 * The one shape for "something you should know about this screen": a tinted
 * card carrying a glyph, an optional title, a reason, and at most one control
 * that resolves it.
 *
 * Five hand-rolled copies of this used to sit in `conversation-screen.tsx`
 * alone, with three paddings between them, two radii, and only four of the
 * five announcing themselves. Every rule that used to be re-decided per call
 * site lives here now: the copy block is the alert region and the action is
 * not, the glyph gets its own column, and the resolution is left-aligned under
 * the copy rather than back at the card's edge.
 *
 * `emphasis` is the fault/state axis, and it is the choice that matters:
 *
 * - **`fill`** — something broke and someone has to clear it. The tinted fill
 *   is the alarm, and it should stay rare enough to mean that.
 * - **`outline`** — a condition that is simply true right now. Neutral
 *   surface, tinted hairline, tinted mark. A closed 24-hour window is the
 *   resting state of most conversations; painting it like a fault spends the
 *   alarm on the common case.
 *
 * Deliberately free of `heroui-native`: it renders through `ui/text` and
 * `ui/glyph`, both of which are plain React Native, so a leaf component can
 * import it without pulling reanimated into that component's test.
 */
export function Notice({
  action,
  children,
  className,
  emphasis = 'fill',
  loading = false,
  symbol,
  testID,
  title,
  tone = 'warning',
}: NoticeProps) {
  const [warning, danger, warningSoft, dangerSoft] = useCSSVariable([
    '--color-warning',
    '--color-danger',
    '--color-warning-soft-foreground',
    '--color-danger-soft-foreground',
  ]);

  const filled = emphasis === 'fill';
  const isDanger = tone === 'danger';

  const surface = filled
    ? isDanger
      ? 'bg-danger-soft'
      : 'bg-warning-soft'
    : isDanger
      ? 'border-danger/30 border'
      : 'border-warning/30 border';

  /*
   * A filled card carries its own foreground so the copy stays legible on the
   * tint. An outlined one sits on the page surface, so it takes the page's own
   * title/body pair and lets the mark alone carry the hue.
   */
  const titleClassName = filled
    ? isDanger
      ? 'text-danger-soft-foreground'
      : 'text-warning-soft-foreground'
    : 'text-foreground';
  const reasonClassName = filled ? titleClassName : 'text-muted';

  /*
   * A filled card's mark takes the soft foreground, the token built to stay
   * legible on that tint. Only an outlined one, sitting on the page surface,
   * can afford the solid tone.
   */
  const solid = isDanger ? danger : warning;
  const onTint = isDanger ? dangerSoft : warningSoft;
  const mark = (filled ? onTint : solid) as ColorValue | undefined;

  return (
    <View
      className={`${surface} flex-row items-start gap-2.5 rounded-2xl px-3 py-3 ${className ?? ''}`.trim()}
      testID={testID}
    >
      {loading ? (
        <View className="pt-0.5">
          {/*
           * Tinted to the notice's own mark. A default spinner keeps the
           * platform's grey and reads as a foreign object dropped on the
           * tint, where the glyph it stands in for is coloured.
           */}
          <ActivityIndicator
            accessibilityElementsHidden
            color={mark ?? PlatformColor('label')}
            importantForAccessibility="no"
            size="small"
          />
        </View>
      ) : symbol ? (
        <View className="pt-0.5">
          <Glyph
            name={symbol}
            size={18}
            tintColor={mark ?? PlatformColor('label')}
          />
        </View>
      ) : null}
      <View className="min-w-0 flex-1 gap-2">
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="gap-0.5"
        >
          {title ? (
            <Text className={`${titleClassName} text-base font-semibold`}>
              {title}
            </Text>
          ) : null}
          <Text className={`${reasonClassName} text-sm`}>{children}</Text>
        </View>
        {action}
      </View>
    </View>
  );
}
