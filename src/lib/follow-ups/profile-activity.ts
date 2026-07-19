interface ProfileActivitySource {
  id: string;
  created_at: string;
}

interface ProfileFollowUpSource extends ProfileActivitySource {
  note_id: string | null;
}

export type ProfileActivityItem<
  Note extends ProfileActivitySource,
  FollowUp extends ProfileFollowUpSource,
> =
  | { key: string; kind: 'note'; createdAt: string; note: Note }
  | {
      key: string;
      kind: 'follow-up';
      createdAt: string;
      followUp: FollowUp;
    };

/**
 * Attach note-linked tasks to their authored note and merge every standalone
 * task into the profile timeline. Newest activity renders first.
 */
export function buildProfileActivity<
  Note extends ProfileActivitySource,
  FollowUp extends ProfileFollowUpSource,
>(notes: Note[], followUps: FollowUp[]) {
  const noteFollowUps: Record<string, FollowUp> = {};
  const standaloneFollowUps: FollowUp[] = [];

  for (const followUp of followUps) {
    if (!followUp.note_id) {
      standaloneFollowUps.push(followUp);
      continue;
    }

    const current = noteFollowUps[followUp.note_id];
    if (!current || current.created_at < followUp.created_at) {
      noteFollowUps[followUp.note_id] = followUp;
    }
  }

  const items: ProfileActivityItem<Note, FollowUp>[] = [
    ...notes.map((note) => ({
      key: `note:${note.id}`,
      kind: 'note' as const,
      createdAt: note.created_at,
      note,
    })),
    ...standaloneFollowUps.map((followUp) => ({
      key: `follow-up:${followUp.id}`,
      kind: 'follow-up' as const,
      createdAt: followUp.created_at,
      followUp,
    })),
  ];

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { noteFollowUps, items };
}
