import { fireEvent, render, screen } from '@testing-library/react-native';

import type { InboxMessageReaction } from '../inbox-types';
import { MessageReactions } from './message-reactions';

const MESSAGE_ID = '94c45d67-692f-4654-8806-668858e84c6b';
const CONVERSATION_ID = '7d6ec8ac-fb05-4df8-9e15-3ba7c5ba2141';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function reaction(
  id: string,
  actorId: string,
  actorType: 'agent' | 'customer',
  emoji: string
): InboxMessageReaction {
  return {
    id,
    messageId: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    actorType,
    actorId,
    emoji,
    createdAt: '2026-09-03T06:00:00.000Z',
  };
}

const reactions = [
  reaction('f34de80d-cdf4-4699-ac10-b0a1f0404cab', USER_ID, 'agent', '👍'),
  reaction(
    '5d7459ed-c7d6-468e-8238-20cc818ba63e',
    'ba8df73d-a33e-4236-a93b-357149bc6ea0',
    'customer',
    '👍'
  ),
  reaction(
    '6cb6f77e-60f3-4945-ac83-6cb69ba6f263',
    '30250c1e-ee34-4af5-8752-2ad170d65713',
    'agent',
    '❤️'
  ),
];

describe('MessageReactions', () => {
  it('groups emoji counts and exposes the current agent reaction as selected', () => {
    const onToggle = jest.fn();
    render(
      <MessageReactions
        currentUserId={USER_ID}
        onToggle={onToggle}
        reactions={reactions}
      />
    );

    const thumbs = screen.getByRole('button', {
      name: '👍 reaction, 2, reacted by you',
    });
    expect(thumbs.props.accessibilityState).toMatchObject({
      busy: false,
      disabled: false,
      selected: true,
    });
    expect(thumbs.props.className).toContain('bg-chat-bubble-in');
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByRole('button', { name: '❤️ reaction, 1' })).toBeTruthy();

    fireEvent.press(thumbs);
    expect(onToggle).toHaveBeenCalledWith('👍');
  });

  it('keeps pending and read-only reactions visible without an active control', () => {
    const onToggle = jest.fn();
    const view = render(
      <MessageReactions
        currentUserId={USER_ID}
        onToggle={onToggle}
        pending
        reactions={reactions.slice(0, 1)}
      />
    );

    const pending = screen.getByRole('button', {
      name: '👍 reaction, 1, reacted by you, updating',
    });
    expect(pending.props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
      selected: true,
    });
    fireEvent.press(pending);
    expect(onToggle).not.toHaveBeenCalled();

    view.rerender(
      <MessageReactions currentUserId={USER_ID} reactions={reactions} />
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.getByLabelText('👍 reaction, 2, reacted by you')
    ).toBeTruthy();
  });
});
