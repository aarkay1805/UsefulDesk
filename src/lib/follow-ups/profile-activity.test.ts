import { describe, expect, it } from 'vitest';

import { buildProfileActivity } from './profile-activity';

describe('profile follow-up activity', () => {
  it('shows standalone follow-ups alongside notes while attaching linked tasks', () => {
    const note = {
      id: 'note-1',
      created_at: '2026-07-18T10:00:00.000Z',
      note_text: 'Asked about the evening batch',
    };
    const linkedFollowUp = {
      id: 'follow-up-linked',
      note_id: note.id,
      created_at: '2026-07-18T10:01:00.000Z',
    };
    const standaloneFollowUp = {
      id: 'follow-up-standalone',
      note_id: null,
      created_at: '2026-07-19T10:00:00.000Z',
      note: null,
    };

    const activity = buildProfileActivity(
      [note],
      [linkedFollowUp, standaloneFollowUp]
    );

    expect(activity.noteFollowUps).toEqual({
      [note.id]: linkedFollowUp,
    });
    expect(activity.items).toEqual([
      {
        key: `follow-up:${standaloneFollowUp.id}`,
        kind: 'follow-up',
        createdAt: standaloneFollowUp.created_at,
        followUp: standaloneFollowUp,
      },
      {
        key: `note:${note.id}`,
        kind: 'note',
        createdAt: note.created_at,
        note,
      },
    ]);
  });
});
