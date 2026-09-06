import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  retired: false,
  retireAfterRead: false,
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from, rpc: h.rpc }),
}));
vi.mock('@/lib/platform-access/server', () => ({
  requireProductAccess: vi.fn().mockResolvedValue({ allowed: true }),
}));
import {
  resumePendingExecution,
  type PendingExecution,
} from '@/lib/automations/engine';

beforeEach(() => {
  h.retired = false;
  h.retireAfterRead = false;
  h.rpc.mockResolvedValue({ data: false, error: null });
  h.from.mockImplementation((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gt: () => builder,
      gte: () => builder,
      order: () => builder,
      single: async () => ({
        data: { id: 'automation', account_id: 'account' },
        error: null,
      }),
      maybeSingle: async () => ({
        data: h.retired ? null : { id: 'pending' },
        error: null,
      }),
      is: async () => {
        if (h.retireAfterRead) h.retired = true;
        return {
          data: [
            {
              id: 'step',
              step_type: 'wait',
              step_config: { amount: 1, unit: 'minutes' },
            },
          ],
          error: null,
        };
      },
    };
    if (
      ![
        'automations',
        'automation_pending_executions',
        'automation_steps',
      ].includes(table)
    )
      throw new Error('Unexpected operational side effect');
    return builder;
  });
});
const pending = {
  id: 'pending',
  automation_id: 'automation',
  account_id: 'account',
  contact_id: 'contact',
  log_id: null,
  parent_step_id: null,
  branch: null,
  next_step_position: 0,
  context: {},
} as PendingExecution;
it.each(['before resume', 'between step load and execution'])(
  'does not resume retired work %s after restored product access',
  async (timing) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.retired = timing === 'before resume';
    h.retireAfterRead = !h.retired;
    await expect(
      resumePendingExecution(pending, 'old-worker')
    ).resolves.toBeUndefined();
    expect(h.from.mock.calls.map(([table]) => table)).not.toContain('contacts');
    if (timing === 'before resume')
      expect(h.from.mock.calls.map(([table]) => table)).not.toContain(
        'automation_steps'
      );
    expect(h.rpc).toHaveBeenCalledWith(
      'finish_automation_execution',
      expect.objectContaining({
        p_status: 'failed',
        p_lease_owner: 'old-worker',
      })
    );
    log.mockRestore();
  }
);
