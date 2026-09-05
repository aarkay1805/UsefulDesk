import { View } from 'react-native';

import { Button } from '../../../ui/button';
import { Notice } from '../../../ui/notice';

export interface ClosedWindowBarProps {
  onOpenTemplates(): void;
}

/**
 * The bottom bar a conversation gets once its 24-hour session has closed.
 *
 * `outline`, not `fill`, and that is the whole point of the component. Every
 * other `Notice` on this screen reports a fault someone has to clear — the
 * realtime channel dropped, the previous template send could not be verified,
 * outbound setup is incomplete. A closed window is none of those: it is the
 * resting state of every conversation nobody has written into for a day, which
 * is most of the inbox. Painting the routine state in the alarm colour spends
 * the alarm, and puts an amber band under the majority of threads. This is the
 * demotion `message-composer.tsx` already makes on web with `bg-card` plus
 * `ring-1 ring-amber-500/25`.
 *
 * A clock, not a triangle: the triangle is what the fault notices here use,
 * and it would say "something broke" about a session that aged out on
 * schedule.
 *
 * The copy names the state and the constraint; the button names the move. The
 * web strip says "Send an approved template to reopen it" *and* labels its
 * button "Send a template", which spends two lines saying one thing twice.
 */
export function ClosedWindowBar({ onOpenTemplates }: ClosedWindowBarProps) {
  return (
    <View className="bg-inbox-panel px-3 py-2" testID="closed-window-action-bar">
      <Notice
        action={
          <Button
            accessibilityLabel="Send a template"
            className="self-start"
            onPress={onOpenTemplates}
            size="sm"
          >
            Send a template
          </Button>
        }
        emphasis="outline"
        symbol="clock"
        title="Reply window closed"
      >
        WhatsApp allows only an approved template until they reply again.
      </Notice>
    </View>
  );
}
