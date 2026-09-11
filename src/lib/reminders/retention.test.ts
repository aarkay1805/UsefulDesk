import { describe, expect, it } from 'vitest';

import {
  isCurrentSessionPackMilestone,
  latestWinBackMilestone,
  selectWinBackMilestone,
  sessionPackMilestone,
  shouldStopWinBack,
} from './retention';

describe('retention reminder policy', () => {
  it('derives current-cycle session thresholds and makes zero supersede low', () => {
    expect(sessionPackMilestone(3)).toBeNull();
    expect(sessionPackMilestone(2)).toEqual({
      key: 'sessions-2',
      offsetDays: 0,
    });
    expect(sessionPackMilestone(0)).toEqual({
      key: 'sessions-0',
      offsetDays: 0,
    });
    expect(isCurrentSessionPackMilestone(0, 'sessions-2')).toBe(false);
    expect(isCurrentSessionPackMilestone(0, 'sessions-0')).toBe(true);
  });

  it('uses only the latest bounded win-back milestone and never backfills before activation', () => {
    expect(
      selectWinBackMilestone({
        endDate: '2026-09-01',
        today: '2026-10-01',
        activatedOn: '2026-08-01',
        handledKeys: [],
        catchUpDays: 2,
      })
    ).toEqual({ key: 'win-back-30', offsetDays: 30 });
    expect(
      selectWinBackMilestone({
        endDate: '2026-09-01',
        today: '2026-10-01',
        activatedOn: '2026-10-02',
        handledKeys: [],
        catchUpDays: 2,
      })
    ).toBeNull();
  });

  it('supersedes a blocked older win-back job before handled-state filtering', () => {
    expect(
      latestWinBackMilestone({
        endDate: '2026-09-01',
        today: '2026-10-01',
        activatedOn: '2026-08-01',
        catchUpDays: 2,
      })
    ).toEqual({ key: 'win-back-30', offsetDays: 30 });
    expect(
      latestWinBackMilestone({
        endDate: '2026-09-01',
        today: '2026-11-05',
        activatedOn: '2026-08-01',
        catchUpDays: 2,
      })
    ).toBeNull();
  });

  it('stops win-back on every authoritative end condition', () => {
    expect(
      shouldStopWinBack({
        renewedOrReplaced: false,
        cancelled: false,
        replied: false,
        openCommitmentOrHold: false,
        shortSequencePending: false,
      })
    ).toBe(false);
    expect(
      shouldStopWinBack({
        renewedOrReplaced: true,
        cancelled: false,
        replied: false,
        openCommitmentOrHold: false,
        shortSequencePending: false,
      })
    ).toBe(true);
    expect(
      shouldStopWinBack({
        renewedOrReplaced: false,
        cancelled: false,
        replied: true,
        openCommitmentOrHold: false,
        shortSequencePending: false,
      })
    ).toBe(true);
  });
});
