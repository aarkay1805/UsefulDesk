import { describe, expect, it } from 'vitest';

import {
  memberSelectionFromRows,
  membershipOnlyMemberSelection,
  retainFailedMemberSelection,
  summarizeMemberSelection,
  toggleMemberPageSelection,
  toggleMemberSelection,
} from './member-selection';

const membership = (contactId: string, membershipId: string) => ({
  contact_id: contactId,
  membership_id: membershipId,
});

const serviceOnly = (contactId: string) => ({
  contact_id: contactId,
  membership_id: null,
});

describe('All Members contact-first selection', () => {
  it('keeps optional membership identity and classifies membership-only, service-only, and mixed selections', () => {
    const membershipSelection = memberSelectionFromRows([
      membership('contact-1', 'membership-1'),
      membership('contact-2', 'membership-2'),
    ]);
    expect([...membershipSelection]).toEqual([
      ['contact-1', 'membership-1'],
      ['contact-2', 'membership-2'],
    ]);
    expect(summarizeMemberSelection(membershipSelection)).toMatchObject({
      totalCount: 2,
      membershipCount: 2,
      serviceOnlyCount: 0,
      membershipActionState: 'available',
    });

    expect(
      summarizeMemberSelection(
        memberSelectionFromRows([serviceOnly('contact-service')])
      )
    ).toMatchObject({
      totalCount: 1,
      membershipCount: 0,
      serviceOnlyCount: 1,
      membershipActionState: 'hidden',
    });

    expect(
      summarizeMemberSelection(
        memberSelectionFromRows([
          membership('contact-member', 'membership-1'),
          serviceOnly('contact-service'),
        ])
      )
    ).toMatchObject({
      totalCount: 2,
      membershipCount: 1,
      serviceOnlyCount: 1,
      membershipActionState: 'blocked',
      contactIds: ['contact-member', 'contact-service'],
      membershipIds: ['membership-1'],
    });
  });

  it('selects service customers individually and through page selection while preserving off-page rows', () => {
    const page = [
      membership('contact-member', 'membership-1'),
      serviceOnly('contact-service'),
    ];
    const initial = memberSelectionFromRows([
      membership('contact-off-page', 'membership-off-page'),
    ]);

    const individual = toggleMemberSelection(initial, page[1]);
    expect(individual.get('contact-service')).toBeNull();

    const selectedPage = toggleMemberPageSelection(initial, page);
    expect([...selectedPage]).toEqual([
      ['contact-off-page', 'membership-off-page'],
      ['contact-member', 'membership-1'],
      ['contact-service', null],
    ]);

    const clearedPage = toggleMemberPageSelection(selectedPage, page);
    expect([...clearedPage]).toEqual([
      ['contact-off-page', 'membership-off-page'],
    ]);
  });

  it('uses the full matching row set without dropping service-only contacts', () => {
    const allMatching = memberSelectionFromRows([
      membership('contact-1', 'membership-1'),
      serviceOnly('contact-2'),
      membership('contact-3', 'membership-3'),
    ]);

    expect([...allMatching]).toEqual([
      ['contact-1', 'membership-1'],
      ['contact-2', null],
      ['contact-3', 'membership-3'],
    ]);
    expect(summarizeMemberSelection(allMatching).totalCount).toBe(3);
  });

  it('resolves mixed membership actions explicitly and retains contact-keyed partial failures', () => {
    const selection = memberSelectionFromRows([
      membership('contact-1', 'membership-1'),
      serviceOnly('contact-2'),
      membership('contact-3', 'membership-3'),
    ]);

    expect([...membershipOnlyMemberSelection(selection)]).toEqual([
      ['contact-1', 'membership-1'],
      ['contact-3', 'membership-3'],
    ]);
    expect([
      ...retainFailedMemberSelection(selection, new Set(['contact-2'])),
    ]).toEqual([['contact-2', null]]);
  });
});
