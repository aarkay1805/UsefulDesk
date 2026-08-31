import { describe, expect, it } from 'vitest';

import { evaluateWorkflowFreshness } from './github-workflow-freshness.mjs';

const workflows = [
  {
    file: 'ops-crons.yml',
    name: 'ops-crons',
    maxAgeMinutes: 75,
  },
];

function run(overrides = {}) {
  return {
    id: 123,
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-30T11:00:00.000Z',
    updated_at: '2026-08-30T11:01:00.000Z',
    html_url: 'https://github.com/aarkay1805/UsefulDesk/actions/runs/123',
    ...overrides,
  };
}

describe('evaluateWorkflowFreshness', () => {
  it('keeps a scheduled success inside its threshold healthy', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows,
      runsByWorkflow: { 'ops-crons.yml': [run()] },
    });

    expect(status).toEqual({
      name: 'ops-crons',
      file: 'ops-crons.yml',
      maxAgeMinutes: 75,
      ageMinutes: 60,
      latestSuccessAt: '2026-08-30T11:00:00.000Z',
      latestSuccessUrl:
        'https://github.com/aarkay1805/UsefulDesk/actions/runs/123',
      stale: false,
      reason: null,
    });
  });

  it('marks a scheduled success older than its threshold stale', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows,
      runsByWorkflow: {
        'ops-crons.yml': [run({ created_at: '2026-08-30T10:44:00.000Z' })],
      },
    });

    expect(status.stale).toBe(true);
    expect(status.ageMinutes).toBe(76);
    expect(status.reason).toBe(
      'latest successful scheduled run is 76 minutes old (limit: 75)'
    );
  });

  it('marks a workflow with no run history stale', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows,
      runsByWorkflow: { 'ops-crons.yml': [] },
    });

    expect(status.stale).toBe(true);
    expect(status.latestSuccessAt).toBeNull();
    expect(status.reason).toBe('no successful scheduled run found');
  });

  it('does not let a manual dispatch hide missing scheduled runs', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows,
      runsByWorkflow: {
        'ops-crons.yml': [run({ event: 'workflow_dispatch' })],
      },
    });

    expect(status.stale).toBe(true);
    expect(status.reason).toBe('no successful scheduled run found');
  });

  it('uses the newest successful scheduled run regardless of API order', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows,
      runsByWorkflow: {
        'ops-crons.yml': [
          run({
            id: 1,
            created_at: '2026-08-30T09:00:00.000Z',
            html_url: 'https://github.com/aarkay1805/UsefulDesk/actions/runs/1',
          }),
          run({
            id: 2,
            created_at: '2026-08-30T11:30:00.000Z',
            html_url: 'https://github.com/aarkay1805/UsefulDesk/actions/runs/2',
          }),
          run({
            id: 3,
            conclusion: 'failure',
            created_at: '2026-08-30T11:45:00.000Z',
          }),
        ],
      },
    });

    expect(status.stale).toBe(false);
    expect(status.ageMinutes).toBe(30);
    expect(status.latestSuccessUrl).toBe(
      'https://github.com/aarkay1805/UsefulDesk/actions/runs/2'
    );
  });

  it('warns without failing health when a redundant scheduler is stale', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows: [{ ...workflows[0], failureOnStale: false }],
      runsByWorkflow: {
        'ops-crons.yml': [run({ created_at: '2026-08-30T10:44:00.000Z' })],
      },
    });

    expect(status.stale).toBe(true);
    expect(status.annotationLevel).toBe('warning');
    expect(status.blocksHealth).toBe(false);
  });

  it('fails health when a required scheduler is stale', () => {
    const [status] = evaluateWorkflowFreshness({
      now: new Date('2026-08-30T12:00:00.000Z'),
      workflows: [{ ...workflows[0], failureOnStale: true }],
      runsByWorkflow: {
        'ops-crons.yml': [run({ created_at: '2026-08-30T10:44:00.000Z' })],
      },
    });

    expect(status.stale).toBe(true);
    expect(status.annotationLevel).toBe('error');
    expect(status.blocksHealth).toBe(true);
  });
});
