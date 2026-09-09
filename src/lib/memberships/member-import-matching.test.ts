import { describe, expect, it, vi } from 'vitest';

import {
  buildMemberImportCandidates,
  resolveExistingContact,
} from './member-import-candidates';
import {
  loadMemberImportMatchIndex,
  preserveMemberImportCandidateSnapshots,
  rematchMemberImportCandidates,
} from './member-import-matching';

describe('member import contact matching', () => {
  it('reads beyond the first thousand contacts and members', async () => {
    const contactsPage = vi.fn(async (from: number) => ({
      data:
        from === 0
          ? Array.from({ length: 1_000 }, (_, index) => ({
              id: `contact-${index}`,
              phone_normalized: `+1555000${String(index).padStart(4, '0')}`,
              received_via: null,
            }))
          : [
              {
                id: 'contact-1000',
                phone_normalized: '+15559999999',
                received_via: 'meta',
              },
            ],
      error: null,
    }));
    const membershipsPage = vi.fn(async (from: number) => ({
      data:
        from === 0
          ? Array.from({ length: 1_000 }, (_, index) => ({
              contact_id: `contact-${index}`,
            }))
          : [{ contact_id: 'contact-1000' }],
      error: null,
    }));

    const index = await loadMemberImportMatchIndex({
      contactsPage,
      membershipsPage,
    });

    expect(contactsPage).toHaveBeenCalledTimes(2);
    expect(membershipsPage).toHaveBeenCalledTimes(2);
    expect(index.contactsByPhone.get('15559999999')?.id).toBe('contact-1000');
    expect(index.memberContactIds.has('contact-1000')).toBe(true);
  });

  it('fails closed when either branch-scoped lookup fails', async () => {
    await expect(
      loadMemberImportMatchIndex({
        contactsPage: async () => ({
          data: null,
          error: new Error('contacts unavailable'),
        }),
        membershipsPage: async () => ({ data: [], error: null }),
      })
    ).rejects.toThrow('contacts unavailable');
  });

  it('retains an existing-contact choice only while the reviewed contact facts match', () => {
    const context = {
      plans: [],
      dateOrder: 'DMY' as const,
      today: '2026-09-09',
    };
    const initial = buildMemberImportCandidates(
      [
        {
          sourceKey: 'csv:2',
          sourceRow: 2,
          originalValues: {
            phone: '+15550000002',
            name: 'CSV name',
            tagNames: [],
            customValues: [],
          },
        },
      ],
      context
    );
    const index = {
      contactsByPhone: new Map([
        [
          '15550000002',
          {
            id: 'contact-1',
            phone_normalized: '+15550000002',
            received_via: null,
            name: 'Saved name',
          },
        ],
      ]),
      memberContactIds: new Set<string>(),
    };
    const reviewed = resolveExistingContact(
      rematchMemberImportCandidates(initial, index, context),
      'csv:2',
      'keep_existing',
      context
    );

    expect(
      rematchMemberImportCandidates(reviewed, index, context, true)[0]
        .resolutions.existingContact
    ).toBe('keep_existing');

    const changed = {
      ...index,
      contactsByPhone: new Map([
        [
          '15550000002',
          {
            ...index.contactsByPhone.get('15550000002')!,
            name: 'Changed saved name',
          },
        ],
      ]),
    };
    expect(
      rematchMemberImportCandidates(reviewed, changed, context, true)[0]
        .resolutions.existingContact
    ).toBeNull();
  });

  it('keeps a journal-owned snapshot while another row is re-matched', () => {
    const context = {
      plans: [],
      dateOrder: 'DMY' as const,
      today: '2026-09-09',
    };
    const current = buildMemberImportCandidates(
      [
        {
          sourceKey: 'csv:2',
          sourceRow: 2,
          originalValues: {
            phone: '+15550000002',
            name: 'Attempted',
            tagNames: [],
            customValues: [],
          },
        },
        {
          sourceKey: 'csv:3',
          sourceRow: 3,
          originalValues: {
            phone: '+15550000003',
            name: 'Edited',
            tagNames: [],
            customValues: [],
          },
        },
      ],
      context
    );
    const rematched = [
      {
        ...current[0],
        disposition: 'excluded' as const,
        exclusionReason: 'existing-member' as const,
      },
      {
        ...current[1],
        draftValues: { ...current[1].draftValues, phone: '+15550000004' },
      },
    ];

    const preserved = preserveMemberImportCandidateSnapshots(
      current,
      rematched,
      new Set(['csv:2'])
    );

    expect(preserved[0]).toBe(current[0]);
    expect(preserved[1]).toBe(rematched[1]);
  });
});
