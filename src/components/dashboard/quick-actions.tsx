"use client"

import Link from 'next/link'
import { UserPlus, Dumbbell, Radio, Zap } from 'lucide-react'
import type { ComponentType } from 'react'

// Quick-action shortcuts. Each navigates to the route that owns the
// relevant create flow. Leads and members use page-owned dialogs, so an
// explicit URL intent asks those pages to open their existing form.
interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { label: 'New Lead', href: '/leads?action=new', icon: UserPlus, tint: 'text-primary-text' },
  { label: 'New Member', href: '/members?action=new', icon: Dumbbell, tint: 'text-blue-foreground' },
  { label: 'New Broadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-foreground' },
  { label: 'New Automation', href: '/automations/new', icon: Zap, tint: 'text-primary-text' },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-border-hover"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-muted ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-foreground">{a.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
