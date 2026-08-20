// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
let resolveCreate!: (response: Response) => void;

vi.mock('next/navigation', () => ({
  usePathname: () => '/flows',
  useRouter: () => ({ push }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, accountRole: 'owner' }),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { default: FlowsPage } = await import('./page');

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      }
      if (url.endsWith('/api/flows/templates')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              templates: [
                {
                  slug: 'welcome',
                  name: 'Welcome message',
                  description: 'Greet new contacts',
                  icon: 'MessageSquare',
                  trigger_type: 'first_inbound_message',
                  node_count: 2,
                },
                {
                  slug: 'faq',
                  name: 'FAQ helper',
                  description: 'Answer common questions',
                  icon: 'HelpCircle',
                  trigger_type: 'keyword',
                  node_count: 3,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ flows: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('flow template creation', () => {
  it('shows progress only on the template being created', async () => {
    const user = userEvent.setup();
    render(<FlowsPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Create your first flow' })
    );
    const welcome = screen.getByRole('button', {
      name: /Welcome message/,
    });
    const faq = screen.getByRole('button', { name: /FAQ helper/ });
    await user.click(welcome);

    try {
      expect(welcome.getAttribute('aria-busy')).toBe('true');
      expect((welcome as HTMLButtonElement).disabled).toBe(true);
      expect(welcome.querySelector('.animate-spin')).not.toBeNull();
      expect(faq.getAttribute('aria-busy')).toBeNull();
    } finally {
      resolveCreate(
        new Response(JSON.stringify({ error: 'Test creation stopped' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
  });
});
