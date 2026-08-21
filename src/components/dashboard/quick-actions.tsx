'use client';

import { BranchLink as Link } from '@/components/layout/branch-link';
import { UserPlus, Dumbbell, Radio, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

// Quick-action shortcuts. Each navigates to the route that owns the
// relevant create flow. Leads and members use page-owned dialogs, so an
// explicit URL intent asks those pages to open their existing form.
interface Action {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const ACTIONS: Action[] = [
  { label: 'Add lead', href: '/leads?action=new', icon: UserPlus },
  { label: 'Add member', href: '/members?action=new', icon: Dumbbell },
  { label: 'Send broadcast', href: '/broadcasts/new', icon: Radio },
  { label: 'Add automation', href: '/automations/new', icon: Zap },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="border-border bg-card hover:border-border-hover flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
          >
            <div className="bg-muted text-foreground flex h-9 w-9 items-center justify-center rounded-lg">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-foreground text-sm font-medium">
              {a.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
